import { describe, expect, it } from "vitest";
import { createFileClient } from "../src/api/file-client.js";
import { createBackendHttpClient } from "../src/api/http-client.js";

describe("file API client", () => {
  it("maps upload metadata creation to the backend route", async () => {
    const requests: Request[] = [];
    const http = createBackendHttpClient({
      baseUrl: "http://localhost:3000",
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({
          file: {
            public_id: "fil_test",
            bucket: "garanti-media",
            object_key: "media/2026/01/02/fil_test/invoice.pdf",
            original_name: "invoice.pdf",
            mime_type: "application/pdf",
            byte_size: 123,
            checksum: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            upload_status: "available",
            scan_status: "skipped",
            upload_type: "singlepart",
            multipart_upload_id: null,
            completed_at: "2026-01-02T03:04:05.000Z",
            abandoned_at: null,
            created_at: "2026-01-02T03:04:05.000Z",
            updated_at: "2026-01-02T03:04:05.000Z",
          },
          upload: {
            method: "PUT",
            bucket: "garanti-media",
            object_key: "media/2026/01/02/fil_test/invoice.pdf",
            headers: {},
            presigned_url: null,
            expires_at: null,
          },
        });
      },
    });

    await createFileClient(http).createUpload({
      original_name: "invoice.pdf",
      mime_type: "application/pdf",
      byte_size: 123,
      checksum: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    });

    expect(requests[0]?.url).toBe("http://localhost:3000/api/files/uploads");
    await expect(requests[0]?.json()).resolves.toEqual({
      original_name: "invoice.pdf",
      mime_type: "application/pdf",
      byte_size: 123,
      checksum: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    });
  });

  it("maps multipart upload boundaries to backend routes", async () => {
    const requests: Request[] = [];
    const http = createBackendHttpClient({
      baseUrl: "http://localhost:3000",
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({});
      },
    });
    const client = createFileClient(http);

    await client.createMultipartUpload({
      original_name: "video.mp4",
      mime_type: "video/mp4",
      byte_size: 15_000_000,
      checksum: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      part_count: 3,
    });
    await client.createMultipartPart("fil_test", {
      part_number: 1,
      checksum: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=",
    });
    await client.completeMultipartUpload("fil_test", {
      upload_id: "upload-1",
      parts: [{ part_number: 1, etag: "\"etag-1\"" }],
    });
    await client.abortMultipartUpload("fil_test", "upload-1");

    expect(requests.map((request) => request.url)).toEqual([
      "http://localhost:3000/api/files/multipart-uploads",
      "http://localhost:3000/api/files/fil_test/multipart-uploads/parts",
      "http://localhost:3000/api/files/fil_test/multipart-uploads/complete",
      "http://localhost:3000/api/files/fil_test/multipart-uploads/abort",
    ]);
  });

  it("maps file metadata reads to the backend route", async () => {
    const requests: Request[] = [];
    const http = createBackendHttpClient({
      baseUrl: "http://localhost:3000",
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({});
      },
    });

    await createFileClient(http).getFile("fil_test");

    expect(requests[0]?.url).toBe("http://localhost:3000/api/files/fil_test");
  });

  it("maps file download instructions to the backend route", async () => {
    const requests: Request[] = [];
    const http = createBackendHttpClient({
      baseUrl: "http://localhost:3000",
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({
          file: {},
          download: {
            method: "GET",
            bucket: "garanti-media",
            object_key: "media/2026/01/02/fil_test/invoice.pdf",
            headers: {},
            presigned_url: "http://localhost:3000/presigned/download/invoice.pdf",
            expires_at: "2026-01-02T03:19:05.000Z",
          },
        });
      },
    });

    await createFileClient(http).createDownload("fil_test");

    expect(requests[0]?.url).toBe("http://localhost:3000/api/files/fil_test/download");
  });

  it("maps orphan candidate reports to the backend route", async () => {
    const requests: Request[] = [];
    const http = createBackendHttpClient({
      baseUrl: "http://localhost:3000",
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({ data: [] });
      },
    });

    await createFileClient(http).listOrphanCandidates({ limit: 10 });

    expect(requests[0]?.url).toBe("http://localhost:3000/api/files/orphans?limit=10");
  });

  it("maps controlled orphan cleanup applies to the backend route", async () => {
    const requests: Request[] = [];
    const http = createBackendHttpClient({
      baseUrl: "http://localhost:3000",
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({});
      },
    });

    await createFileClient(http).createOrphanCleanupApply("fil_test", {
      confirmation: "delete_orphan_object",
      reason: "approved-production-lifecycle",
    });

    expect(requests[0]?.url).toBe("http://localhost:3000/api/files/fil_test/orphan-cleanup");
    await expect(requests[0]?.json()).resolves.toEqual({
      reason: "approved-production-lifecycle",
      confirmation: "delete_orphan_object",
    });
  });
});
