import type { BackendHttpClient } from "./http-client.js";

export interface FileMetadata {
  public_id: string;
  bucket: string;
  object_key: string;
  original_name: string | null;
  mime_type: string | null;
  byte_size: number | null;
  checksum: string | null;
  created_at: string;
  updated_at: string;
}

export interface UploadInstruction {
  method: "PUT";
  bucket: string;
  object_key: string;
  headers: Record<string, string>;
  presigned_url: string | null;
  expires_at: string | null;
}

export interface DownloadInstruction {
  method: "GET";
  bucket: string;
  object_key: string;
  headers: Record<string, string>;
  presigned_url: string | null;
  expires_at: string | null;
}

export interface CreateFileUploadInput {
  original_name?: string | null;
  mime_type?: string | null;
  byte_size?: number | null;
  checksum?: string | null;
}

export interface FileOrphanListOptions {
  limit?: number;
}

export interface FileOrphanCleanupDryRun {
  mode: "dry_run";
  request_id: string;
  deletion_performed: false;
  eligible_for_cleanup: boolean;
  reason: string | null;
  file: FileMetadata;
  storage_action: {
    provider: string;
    bucket: string;
    object_key: string;
    operation: "delete_object";
  };
}

export interface FileOrphanCleanupApply {
  mode: "apply";
  request_id: string;
  deletion_performed: true;
  eligible_for_cleanup: boolean;
  reason: string | null;
  file: FileMetadata;
  storage_action: FileOrphanCleanupDryRun["storage_action"] & {
    deletion_performed: true;
  };
}

export interface FileOrphanSummary {
  total_count: number;
}

function orphanQuery(options: FileOrphanListOptions = {}) {
  const params = new URLSearchParams();
  if (typeof options.limit === "number") {
    params.set("limit", String(options.limit));
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}

export function createFileClient(http: BackendHttpClient) {
  return {
    createUpload: (input: CreateFileUploadInput) =>
      http.request<{ file: FileMetadata; upload: UploadInstruction }>("/api/files/uploads", {
        method: "POST",
        body: input,
      }),
    getFile: (filePublicId: string) =>
      http.request<FileMetadata>(`/api/files/${encodeURIComponent(filePublicId)}`),
    createDownload: (filePublicId: string) =>
      http.request<{ file: FileMetadata; download: DownloadInstruction }>(
        `/api/files/${encodeURIComponent(filePublicId)}/download`,
      ),
    listOrphanCandidates: (options?: FileOrphanListOptions) =>
      http.request<{ data: FileMetadata[]; summary: FileOrphanSummary }>(
        `/api/files/orphans${orphanQuery(options)}`,
      ),
    createOrphanCleanupDryRun: (filePublicId: string, reason = "admin_orphan_lifecycle_review") =>
      http.request<FileOrphanCleanupDryRun>(
        `/api/files/${encodeURIComponent(filePublicId)}/orphan-cleanup-dry-run`,
        {
          method: "POST",
          body: { reason },
        },
      ),
    createOrphanCleanupApply: (
      filePublicId: string,
      input: { confirmation: "delete_orphan_object"; reason?: string | null },
    ) =>
      http.request<FileOrphanCleanupApply>(
        `/api/files/${encodeURIComponent(filePublicId)}/orphan-cleanup`,
        {
          method: "POST",
          body: {
            reason: input.reason ?? "admin_orphan_lifecycle_review",
            confirmation: input.confirmation,
          },
        },
      ),
  };
}
