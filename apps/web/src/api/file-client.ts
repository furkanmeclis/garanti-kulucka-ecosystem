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
      http.request<{ data: FileMetadata[] }>(`/api/files/orphans${orphanQuery(options)}`),
  };
}
