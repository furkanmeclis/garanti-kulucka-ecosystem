import { describe, expect, it } from "vitest";
import {
  applyConversationMigrationBatchWithState,
  applyMessageMigrationBatchWithState,
} from "../src/apply.js";
import { calculateSourcePayloadChecksum } from "../src/legacy-source.js";
import { legacyIdMapKey } from "../src/id-map.js";
import type {
  CanonicalRecord,
  CanonicalWriteResult,
  ConversationCanonicalRecord,
  LegacyIdMapEntry,
  LegacyIdMapKey,
  LegacyIdMapWrite,
  LegacyRecord,
  LegacySource,
  MessageCanonicalRecord,
  FileCanonicalRecord,
  MessageAttachmentCanonicalRecord,
  MigrationBatch,
  MigrationBatchState,
  MigrationBatchStateFailure,
  MigrationBatchStateKey,
  MigrationBatchStateStart,
  MigrationBatchStateSuccess,
  MigrationEntity,
  MigrationRunRegistration,
  MigrationRunState,
  MigrationTarget,
  SourceTableSnapshot,
} from "../src/types.js";

const customerId = "0a32ce63-4c3b-4fd4-917d-726d540a7216";
const conversationId = "6f1c2b3a-4d5e-4f60-8172-93a4b5c6d7e8";
const messageOneId = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const messageTwoId = "2a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const runId = "run_conversation_apply";

describe("conversation and message apply", () => {
  it("writes conversations through FK-resolving legacy maps and enforces account provider alignment", async () => {
    const target = new ConversationMemoryTarget();
    target.seedMap("public.musteriler", customerId, "customers", "primary", "cus_0123456789abcdef01234567");
    const source = new MemorySource([conversationRecord()]);

    await expect(applyConversationMigrationBatchWithState({
      runId,
      source,
      target,
      batch: batch("conversations", 1),
      integrationAccounts: [
        { publicId: "iac_whatsapp_main", providerKey: "whatsapp", status: "active", externalAccountId: null },
      ],
    })).resolves.toMatchObject({ readRows: 1, writtenRows: 1, idMapCreated: 1 });

    expect(target.records[0]).toMatchObject({
      targetTable: "conversations",
      payload: {
        customer_id: "cus_0123456789abcdef01234567",
        integration_account_id: "iac_whatsapp_main",
        channel: "whatsapp",
      },
    });

    const mismatchTarget = new ConversationMemoryTarget({
      "iac_whatsapp_main": "instagram",
    });
    mismatchTarget.seedMap(
      "public.musteriler",
      customerId,
      "customers",
      "primary",
      "cus_0123456789abcdef01234567",
      "run_provider_mismatch",
    );

    await expect(applyConversationMigrationBatchWithState({
      runId: "run_provider_mismatch",
      source,
      target: mismatchTarget,
      batch: batch("conversations", 1),
      integrationAccounts: [
        { publicId: "iac_whatsapp_main", providerKey: "whatsapp", status: "active", externalAccountId: null },
      ],
    })).rejects.toThrow(
      "Conversation channel whatsapp does not match integration account iac_whatsapp_main provider instagram",
    );
  });

  it("fails closed when the prerequisite customer id map is missing", async () => {
    const target = new ConversationMemoryTarget();

    await expect(applyConversationMigrationBatchWithState({
      runId: "run_missing_customer",
      source: new MemorySource([conversationRecord()]),
      target,
      batch: batch("conversations", 1),
      integrationAccounts: [
        { publicId: "iac_whatsapp_main", providerKey: "whatsapp", status: "active", externalAccountId: null },
      ],
    })).rejects.toThrow(`Cannot resolve customer legacy id public.musteriler.${customerId} from legacy_id_map`);
    expect(target.records).toEqual([]);
  });

  it("writes messages in sent_at plus legacy id order and preserves medya raw payload explicitly", async () => {
    const target = new ConversationMemoryTarget();
    target.seedMap("public.konusmalar", conversationId, "conversations", "primary", "conv_89abcdef0123456789abcdef");
    const source = new MemorySource([
      messageRecord(messageTwoId, { medya_url: "https://cdn.example.test/a.jpg", medya_tipi: "image" }),
      messageRecord(messageOneId),
    ]);

    await expect(applyMessageMigrationBatchWithState({
      runId,
      source,
      target,
      batch: batch("messages", 2),
    })).resolves.toMatchObject({ readRows: 2, writtenRows: 2, idMapCreated: 2 });

    expect(target.records.map((record) => record.targetId)).toEqual([
      expect.stringMatching(/^msg_[0-9a-f]{24}$/),
      expect.stringMatching(/^msg_[0-9a-f]{24}$/),
    ]);
    expect(target.records.map((record) => record.payload.body)).toEqual([
      `body-${messageOneId}`,
      `body-${messageTwoId}`,
    ]);
    expect(target.records[1]).toMatchObject({
      targetTable: "messages",
      payload: {
        conversation_id: "conv_89abcdef0123456789abcdef",
        raw_payload: { medya_url: "https://cdn.example.test/a.jpg", medya_tipi: "image" },
      },
    });

    await expect(applyMessageMigrationBatchWithState({
      runId,
      source,
      target,
      batch: batch("messages", 2),
    })).resolves.toMatchObject({ readRows: 2, writtenRows: 2, idMapCreated: 2 });
    expect(target.records).toHaveLength(2);
  });

  it("fails closed on inline media when storage is not configured before writing", async () => {
    const target = new ConversationMemoryTarget();
    target.seedMap(
      "public.konusmalar",
      conversationId,
      "conversations",
      "primary",
      "conv_89abcdef0123456789abcdef",
      "run_bad_media",
    );

    await expect(applyMessageMigrationBatchWithState({
      runId: "run_bad_media",
      source: new MemorySource([messageRecord(messageOneId, { media_url: "data:image/png;base64,aGVsbG8=" })]),
      target,
      batch: batch("messages", 1),
    })).rejects.toThrow("Message apply requires migrator media storage configuration for inline data URLs");
    expect(target.records).toEqual([]);
  });

  it("extracts inline media to files and message attachments through the storage port", async () => {
    const target = new ConversationMemoryTarget();
    target.seedMap(
      "public.konusmalar",
      conversationId,
      "conversations",
      "primary",
      "conv_89abcdef0123456789abcdef",
      "run_inline_media",
    );
    const storage = new FakeMediaStorage();

    await expect(applyMessageMigrationBatchWithState({
      runId: "run_inline_media",
      source: new MemorySource([messageRecord(messageOneId, {
        media_url: "data:image/png;base64,aGVsbG8=",
        media_type: "image",
        gonderici_adi: "Ayse",
      })]),
      target,
      batch: batch("messages", 1),
      mediaStorage: storage,
    })).resolves.toMatchObject({ readRows: 1, writtenRows: 3, idMapCreated: 1 });

    expect(storage.objects).toEqual([
      expect.objectContaining({ checksum: "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824" }),
    ]);
    expect(target.records.map((record) => record.targetTable).sort()).toEqual([
      "files",
      "message_attachments",
      "messages",
    ]);
    expect(target.records.find((record) => record.targetTable === "messages")?.payload.raw_payload).toMatchObject({
      media_storage: {
        bucket: "migration-media",
        checksum: "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        mime_type: "image/png",
        byte_size: 5,
      },
    });
  });
});

describe("bridge-extracted s3:// legacy media apply", () => {
  const hash = "c".repeat(64);
  const legacyUri = `s3://gk-legacy-media/mesajlar/${hash}.jpg`;
  const legacyKey = `gk-legacy-media/mesajlar/${hash}.jpg`;

  function seededTarget(mapRunId: string): ConversationMemoryTarget {
    const target = new ConversationMemoryTarget();
    target.seedMap("public.konusmalar", conversationId, "conversations", "primary", "conv_89abcdef0123456789abcdef", mapRunId);
    return target;
  }

  it("links the existing object as a files row without re-uploading, sized by HEAD", async () => {
    const target = seededTarget("run_s3_media");
    const storage = new FakeMediaStorage();
    storage.existingObjects.set(legacyKey, 2048);
    const source = new MemorySource([messageRecord(messageOneId, { media_url: legacyUri, media_type: "image" })]);

    await expect(applyMessageMigrationBatchWithState({
      runId: "run_s3_media",
      source,
      target,
      batch: batch("messages", 1),
      mediaStorage: storage,
    })).resolves.toMatchObject({ readRows: 1, writtenRows: 3, idMapCreated: 1 });

    expect(storage.objects).toEqual([]);
    expect(storage.heads).toEqual([legacyKey]);
    const file = target.records.find((record) => record.targetTable === "files");
    expect(file).toMatchObject({
      targetId: expect.stringMatching(/^fil_[0-9a-f]{24}$/),
      checksum: `sha256:${hash}`,
      payload: {
        bucket: "gk-legacy-media",
        object_key: `mesajlar/${hash}.jpg`,
        mime_type: "image/jpeg",
        byte_size: 2048,
        checksum: `sha256:${hash}`,
        upload_status: "available",
        scan_status: "skipped",
      },
    });
    expect(target.records.find((record) => record.targetTable === "message_attachments")).toMatchObject({
      checksum: `sha256:${hash}`,
      payload: { attachment_type: "image", file_id: file?.targetId },
    });
    const rawPayload = target.records.find((record) => record.targetTable === "messages")?.payload.raw_payload;
    expect(rawPayload).not.toHaveProperty("media_url");
    expect(rawPayload).toMatchObject({
      media_type: "image",
      media_storage: { bucket: "gk-legacy-media", object_key: `mesajlar/${hash}.jpg`, byte_size: 2048 },
    });

    // Idempotent rerun: same public ids, no duplicate rows, still no upload.
    const before = target.records.map((record) => `${record.targetTable}:${record.targetId}`).sort();
    await expect(applyMessageMigrationBatchWithState({
      runId: "run_s3_media",
      source,
      target,
      batch: batch("messages", 1),
      mediaStorage: storage,
    })).resolves.toMatchObject({ readRows: 1, writtenRows: 3 });
    expect(target.records.map((record) => `${record.targetTable}:${record.targetId}`).sort()).toEqual(before);
    expect(storage.objects).toEqual([]);
  });

  it("uses a full MIME media_type and honours a configured legacy bucket", async () => {
    const target = seededTarget("run_s3_bucket");
    const storage = new FakeMediaStorage();
    storage.existingObjects.set(`bridge-media/mesajlar/${hash}.ogg`, 10);

    await expect(applyMessageMigrationBatchWithState({
      runId: "run_s3_bucket",
      source: new MemorySource([messageRecord(messageOneId, {
        media_url: `s3://bridge-media/mesajlar/${hash}.ogg`,
        media_type: "audio/ogg",
      })]),
      target,
      batch: batch("messages", 1),
      mediaStorage: storage,
      legacyMediaBucket: "bridge-media",
    })).resolves.toMatchObject({ writtenRows: 3 });
    expect(target.records.find((record) => record.targetTable === "files")?.payload).toMatchObject({
      bucket: "bridge-media",
      mime_type: "audio/ogg",
      byte_size: 10,
    });
  });

  it.each([
    [`s3://gk-legacy-media/mesajlar/${hash.slice(1)}.jpg`, "object key file name"],
    [`s3://gk-legacy-media/other/${hash}.jpg`, "object key must be mesajlar/"],
    [`s3://gk-legacy-media/mesajlar/${hash}.svg`, "unknown media extension .svg"],
    [`s3://Bad_Bucket/mesajlar/${hash}.jpg`, "bucket name has invalid characters"],
    [`s3://gk-legacy-media/mesajlar/${hash}.jpg?x=1`, "object key file name"],
    [`S3://gk-legacy-media/mesajlar/${hash}.jpg`, "scheme must be lowercase"],
  ])("fails closed before any write on malformed URI %s", async (uri, reason) => {
    const target = seededTarget("run_s3_malformed");
    const storage = new FakeMediaStorage();

    await expect(applyMessageMigrationBatchWithState({
      runId: "run_s3_malformed",
      source: new MemorySource([messageRecord(messageOneId, { media_url: uri, media_type: "image" })]),
      target,
      batch: batch("messages", 1),
      mediaStorage: storage,
    })).rejects.toThrow(reason);
    expect(target.records).toEqual([]);
    expect(storage.heads).toEqual([]);
  });

  it("fails the whole batch closed before writes when HEAD reports the object missing", async () => {
    const target = seededTarget("run_s3_missing");
    const storage = new FakeMediaStorage();

    await expect(applyMessageMigrationBatchWithState({
      runId: "run_s3_missing",
      source: new MemorySource([
        messageRecord(messageOneId),
        messageRecord(messageTwoId, { media_url: legacyUri, media_type: "image" }),
      ]),
      target,
      batch: batch("messages", 2),
      mediaStorage: storage,
    })).rejects.toThrow(`Legacy media object ${legacyUri} for public.mesajlar.${messageTwoId} is missing in storage`);
    expect(target.records).toEqual([]);
  });

  it("fails closed when s3:// media is present without a storage port", async () => {
    const target = seededTarget("run_s3_nostorage");

    await expect(applyMessageMigrationBatchWithState({
      runId: "run_s3_nostorage",
      source: new MemorySource([messageRecord(messageOneId, { media_url: legacyUri, media_type: "image" })]),
      target,
      batch: batch("messages", 1),
    })).rejects.toThrow("Message apply requires migrator media storage configuration for legacy s3:// media");
    expect(target.records).toEqual([]);
  });

  it("handles a mixed data:/s3:/https: batch with one upload, one HEAD and one passthrough", async () => {
    const target = seededTarget("run_s3_mixed");
    const storage = new FakeMediaStorage();
    storage.existingObjects.set(legacyKey, 7);
    const messageThreeId = "3a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

    await expect(applyMessageMigrationBatchWithState({
      runId: "run_s3_mixed",
      source: new MemorySource([
        messageRecord(messageOneId, { media_url: "data:image/png;base64,aGVsbG8=", media_type: "image" }),
        messageRecord(messageTwoId, { media_url: legacyUri, media_type: "image" }),
        messageRecord(messageThreeId, { media_url: "https://cdn.example.test/b.jpg", media_type: "image" }),
      ]),
      target,
      batch: batch("messages", 3),
      mediaStorage: storage,
    })).resolves.toMatchObject({ readRows: 3, writtenRows: 7, idMapCreated: 3 });

    expect(storage.objects).toHaveLength(1);
    expect(storage.heads).toEqual([legacyKey]);
    const files = target.records.filter((record) => record.targetTable === "files");
    expect(files.map((record) => record.payload.bucket).sort()).toEqual(["gk-legacy-media", "migration-media"]);
    expect(target.records.filter((record) => record.targetTable === "message_attachments")).toHaveLength(2);
    const remote = target.records.find((record) =>
      record.targetTable === "messages" && record.payload.body === `body-${messageThreeId}`
    );
    expect(remote?.payload.raw_payload).toMatchObject({ media_url: "https://cdn.example.test/b.jpg" });
    expect(remote?.payload.raw_payload).not.toHaveProperty("media_storage");
  });
});

class MemorySource implements LegacySource {
  constructor(private readonly rows: readonly LegacyRecord[]) {}

  async count(_entity: MigrationEntity): Promise<number> {
    return this.rows.length;
  }

  async readBatch(_entity: MigrationEntity, options: { limit: number; offset?: number }): Promise<LegacyRecord[]> {
    const offset = options.offset ?? 0;
    return this.rows.slice(offset, offset + options.limit).map((row) => ({ ...row, payload: { ...row.payload } }));
  }

  async describeTables(entities: readonly MigrationEntity[]): Promise<SourceTableSnapshot[]> {
    return entities.map((entity) => ({ entity, schema: "public", table: entity, idColumn: "id", columns: [] }));
  }
}

class ConversationMemoryTarget implements MigrationTarget {
  private readonly idMaps = new Map<string, LegacyIdMapEntry>();
  private readonly batchStates = new Map<string, MigrationBatchState>();
  private readonly accountProviders: Record<string, string>;
  readonly records: CanonicalRecord[] = [];

  constructor(accountProviders: Record<string, string> = { iac_whatsapp_main: "whatsapp" }) {
    this.accountProviders = accountProviders;
  }

  seedMap(
    sourceTable: string,
    sourceId: string,
    targetTable: string,
    mappingRole: string,
    targetId: string,
    mapRunId = runId,
  ): void {
    const entry = {
      runId: mapRunId,
      sourceSystem: "legacy_postgres",
      sourceTable,
      sourceId,
      targetTable,
      mappingRole,
      targetId,
      checksum: null,
      migratedAt: new Date("2026-10-05T00:00:00.000Z"),
    };
    this.idMaps.set(legacyIdMapKey(entry), entry);
  }

  async writeCanonicalRecord(input: CanonicalRecord): Promise<CanonicalWriteResult> {
    this.upsertRecord(input);
    return { status: "created", record: input };
  }

  async writeConversationRecord(input: ConversationCanonicalRecord): Promise<CanonicalWriteResult> {
    const provider = input.integrationAccountPublicId === null ? null : this.accountProviders[input.integrationAccountPublicId];
    if (input.integrationAccountPublicId !== null && provider === undefined) {
      throw new Error(`Cannot resolve integration account public id ${input.integrationAccountPublicId}`);
    }
    if (provider !== null && provider !== input.payload.channel) {
      throw new Error(
        `Conversation channel ${input.payload.channel} does not match integration account ${input.integrationAccountPublicId} provider ${provider}`,
      );
    }
    const record = {
      targetTable: input.targetTable,
      targetId: input.targetId,
      checksum: input.checksum,
      payload: {
        ...input.payload,
        customer_id: input.customerPublicId,
        assigned_user_id: input.assignedUserPublicId,
        integration_account_id: input.integrationAccountPublicId,
      },
    };
    this.upsertRecord(record);
    return { status: "created", record };
  }

  async writeMessageRecord(input: MessageCanonicalRecord): Promise<CanonicalWriteResult> {
    const record = {
      targetTable: input.targetTable,
      targetId: input.targetId,
      checksum: input.checksum,
      payload: {
        ...input.payload,
        conversation_id: input.conversationPublicId,
      },
    };
    this.upsertRecord(record);
    return { status: "created", record };
  }

  async writeFileRecord(input: FileCanonicalRecord): Promise<CanonicalWriteResult> {
    const record = {
      targetTable: input.targetTable,
      targetId: input.targetId,
      checksum: input.checksum,
      payload: { ...input.payload },
    };
    this.upsertRecord(record);
    return { status: "created", record };
  }

  async writeMessageAttachmentRecord(input: MessageAttachmentCanonicalRecord): Promise<CanonicalWriteResult> {
    const record = {
      targetTable: input.targetTable,
      targetId: input.targetId,
      checksum: input.checksum,
      payload: {
        ...input.payload,
        message_id: input.messagePublicId,
        file_id: input.filePublicId,
      },
    };
    this.upsertRecord(record);
    return { status: "created", record };
  }

  async findLegacyIdMap(input: LegacyIdMapKey): Promise<LegacyIdMapEntry | null> {
    return this.idMaps.get(legacyIdMapKey(input)) ?? null;
  }

  async upsertLegacyIdMap(input: LegacyIdMapWrite): Promise<LegacyIdMapEntry> {
    const entry = { ...input, migratedAt: new Date("2026-10-05T00:00:00.000Z") };
    this.idMaps.set(legacyIdMapKey(input), entry);
    return entry;
  }

  async findMigrationBatchState(input: MigrationBatchStateKey): Promise<MigrationBatchState | null> {
    return this.batchStates.get(batchStateKey(input.runId, input.batch)) ?? null;
  }

  async recordMigrationBatchStarted(input: MigrationBatchStateStart): Promise<MigrationBatchState> {
    const state = batchState(input.runId, input.batch, "running", {});
    this.batchStates.set(batchStateKey(input.runId, input.batch), state);
    return state;
  }

  async recordMigrationBatchSucceeded(input: MigrationBatchStateSuccess): Promise<MigrationBatchState> {
    const state = batchState(input.runId, input.batch, "succeeded", {
      readRows: input.result.readRows,
      writtenRows: input.result.writtenRows,
      idMapCreated: input.result.idMapCreated,
      idMapUpdated: input.result.idMapUpdated,
      idMapUnchanged: input.result.idMapUnchanged,
    });
    this.batchStates.set(batchStateKey(input.runId, input.batch), state);
    return state;
  }

  async recordMigrationBatchFailed(input: MigrationBatchStateFailure): Promise<MigrationBatchState> {
    const state = batchState(input.runId, input.batch, "failed", { errorMessage: input.error.message });
    this.batchStates.set(batchStateKey(input.runId, input.batch), state);
    return state;
  }

  async registerMigrationRun(input: MigrationRunRegistration): Promise<MigrationRunState> {
    return { ...input, createdAt: new Date("2026-10-05T00:00:00.000Z") };
  }

  private upsertRecord(record: CanonicalRecord): void {
    const index = this.records.findIndex((existing) =>
      existing.targetTable === record.targetTable && existing.targetId === record.targetId
    );
    if (index === -1) {
      this.records.push(record);
    } else {
      this.records[index] = record;
    }
  }
}

class FakeMediaStorage {
  readonly heads: string[] = [];
  readonly existingObjects = new Map<string, number>();
  readonly objects: Array<{
    readonly checksum: string;
    readonly mimeType: string;
    readonly size: number;
    readonly bucket: string;
    readonly objectKey: string;
  }> = [];

  async storeInlineDataUrl(input: { readonly dataUrl: string }) {
    const bytes = Buffer.from(input.dataUrl.split(",")[1]!, "base64");
    const object = {
      checksum: "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      mimeType: "image/png",
      size: bytes.byteLength,
      bucket: "migration-media",
      objectKey: "legacy/hello.png",
    };
    this.objects.push(object);
    return object;
  }

  async headObject(input: { readonly bucket: string; readonly objectKey: string }) {
    const key = `${input.bucket}/${input.objectKey}`;
    this.heads.push(key);
    const size = this.existingObjects.get(key);
    return size === undefined ? null : { size };
  }
}

function conversationRecord(overrides: Record<string, unknown> = {}): LegacyRecord {
  const payload = {
    id: conversationId,
    musteri_id: customerId,
    kanal: "whatsapp",
    kanal_konusma_id: "wa-thread-1",
    atanan_kullanici_id: null,
    durum: "acik",
    son_mesaj_tarihi: "2024-03-04T05:06:07Z",
    okunmamis_sayisi: 1,
    olusturma_tarihi: "2024-03-04T05:00:00Z",
    guncelleme_tarihi: null,
    son_mesaj_text: "Merhaba",
    son_mesaj_gonderici: "musteri",
    ig_account_id: null,
    human_agent: false,
    ...overrides,
  };
  return legacyRow("public.konusmalar", conversationId, payload);
}

function messageRecord(id: string, overrides: Record<string, unknown> = {}): LegacyRecord {
  const payload = {
    id,
    konusma_id: conversationId,
    gonderici_tipi: "musteri",
    gonderici_id: null,
    icerik: `body-${id}`,
    medya_url: null,
    medya_tipi: null,
    kanal_mesaj_id: `wamid.${id}`,
    okundu: false,
    olusturma_tarihi: "2024-03-04T05:06:07Z",
    ...overrides,
  };
  return legacyRow("public.mesajlar", id, payload);
}

function legacyRow(sourceTable: string, id: string, payload: Record<string, unknown>): LegacyRecord {
  return {
    sourceSystem: "legacy_postgres",
    sourceTable,
    sourceId: id,
    payload,
    checksum: calculateSourcePayloadChecksum(payload),
  };
}

function batch(entity: MigrationEntity, expectedRows: number): MigrationBatch {
  return {
    entity,
    batchNumber: 1,
    limit: expectedRows,
    offset: 0,
    expectedRows,
  };
}

function batchState(
  runIdValue: string,
  batchValue: MigrationBatch,
  status: MigrationBatchState["status"],
  overrides: Partial<MigrationBatchState>,
): MigrationBatchState {
  return {
    runId: runIdValue,
    entity: batchValue.entity,
    batchNumber: batchValue.batchNumber,
    status,
    limit: batchValue.limit,
    offset: batchValue.offset,
    expectedRows: batchValue.expectedRows,
    readRows: 0,
    writtenRows: 0,
    skippedRows: 0,
    idMapCreated: 0,
    idMapUpdated: 0,
    idMapUnchanged: 0,
    warnings: [],
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

function batchStateKey(runIdValue: string, batchValue: { entity: MigrationEntity; batchNumber: number }): string {
  return `${runIdValue}:${batchValue.entity}:${batchValue.batchNumber}`;
}
