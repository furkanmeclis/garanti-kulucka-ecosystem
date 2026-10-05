import type { AppDatabase } from "@garanti-kulucka/database";
import { z } from "zod";
import type { SettingsCache } from "../settings/cache.js";

const defaultAllowedContentTypes = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
];

export interface StorageUploadPolicy {
  allowedContentTypes: string[];
  maxUploadBytes: number;
  requireSha256Checksum: boolean;
}

export interface StorageMalwareScanPolicy {
  mode: "skip" | "manual";
  allowSkippedDownloads: boolean;
}

export interface StoragePolicies {
  upload: StorageUploadPolicy;
  malwareScan: StorageMalwareScanPolicy;
}

const uploadPolicySchema = z.object({
  allowed_content_types: z.array(z.string().trim().min(1)).min(1),
  max_upload_bytes: z.number().int().positive(),
  require_sha256_checksum: z.boolean(),
});

const malwareScanPolicySchema = z.object({
  mode: z.enum(["skip", "manual"]),
  allow_skipped_downloads: z.boolean(),
});

export const defaultStoragePolicies: StoragePolicies = {
  upload: {
    allowedContentTypes: defaultAllowedContentTypes,
    maxUploadBytes: 50 * 1024 * 1024,
    requireSha256Checksum: true,
  },
  malwareScan: {
    mode: "skip",
    allowSkippedDownloads: true,
  },
};

export async function loadStoragePolicies(input: {
  db: AppDatabase;
  settingsCache: SettingsCache | null;
}): Promise<StoragePolicies> {
  const settings =
    input.settingsCache?.get("global") ??
    (await input.db
      .selectFrom("settings")
      .selectAll()
      .where("scope", "=", "global")
      .execute());
  const values = new Map(settings.map((setting) => [setting.key, setting.value]));
  const upload = uploadPolicySchema
    .catch({
      allowed_content_types: defaultStoragePolicies.upload.allowedContentTypes,
      max_upload_bytes: defaultStoragePolicies.upload.maxUploadBytes,
      require_sha256_checksum: defaultStoragePolicies.upload.requireSha256Checksum,
    })
    .parse(values.get("storage.upload_policy"));
  const malwareScan = malwareScanPolicySchema
    .catch({
      mode: defaultStoragePolicies.malwareScan.mode,
      allow_skipped_downloads: defaultStoragePolicies.malwareScan.allowSkippedDownloads,
    })
    .parse(values.get("storage.malware_scan_policy"));

  return {
    upload: {
      allowedContentTypes: upload.allowed_content_types,
      maxUploadBytes: upload.max_upload_bytes,
      requireSha256Checksum: upload.require_sha256_checksum,
    },
    malwareScan: {
      mode: malwareScan.mode,
      allowSkippedDownloads: malwareScan.allow_skipped_downloads,
    },
  };
}

export function initialScanStatus(policy: StorageMalwareScanPolicy): "pending" | "skipped" {
  return policy.mode === "skip" ? "skipped" : "pending";
}

export function scanStatusAllowsDownload(
  scanStatus: "pending" | "clean" | "infected" | "skipped",
  policy: StorageMalwareScanPolicy,
): boolean {
  return scanStatus === "clean" || (scanStatus === "skipped" && policy.allowSkippedDownloads);
}

export function isValidSha256Checksum(input: string | null | undefined): input is string {
  return typeof input === "string" && /^[A-Za-z0-9+/]{43}=$/.test(input);
}
