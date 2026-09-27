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
});
