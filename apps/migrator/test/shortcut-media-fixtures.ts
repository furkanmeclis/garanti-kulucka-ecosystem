import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export async function startShortcutMediaServer() {
  const objects = new Map<string, Buffer>();
  const requests: { method: string; path: string }[] = [];
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url!, "http://localhost").pathname);
    requests.push({ method: req.method!, path });
    if (path.startsWith("/storage/v1/object/public/")) {
      if (path.endsWith("missing.pdf")) { res.writeHead(404); res.end(); return; }
      if (path.endsWith("redirect.pdf")) { res.writeHead(302, { location: "http://127.0.0.1:1/private" }); res.end(); return; }
      if (path.endsWith("large.pdf")) { res.writeHead(200, { "content-length": String(26 * 1024 * 1024) }); res.end(); return; }
      const body = Buffer.from("local PDF fixture");
      res.writeHead(200, { "content-type": "application/pdf", "content-length": String(body.length) }); res.end(body); return;
    }
    if (req.method === "HEAD") {
      const object = objects.get(path);
      res.writeHead(object ? 200 : 404, object ? { "content-length": String(object.length) } : {}); res.end(); return;
    }
    if (req.method === "PUT") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      objects.set(path, Buffer.concat(chunks));
      res.writeHead(200, { etag: '"local-fixture"' }); res.end(); return;
    }
    res.writeHead(400); res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, objects, requests, close: () => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections();
  }) };
}
