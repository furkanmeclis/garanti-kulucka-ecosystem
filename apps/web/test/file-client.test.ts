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
            checksum: null,
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
    });

    expect(requests[0]?.url).toBe("http://localhost:3000/api/files/uploads");
    await expect(requests[0]?.json()).resolves.toEqual({
      original_name: "invoice.pdf",
      mime_type: "application/pdf",
      byte_size: 123,
    });
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
