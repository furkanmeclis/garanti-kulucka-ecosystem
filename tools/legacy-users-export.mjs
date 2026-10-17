import { readFile, realpath, lstat, open } from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import pg from "pg";

export async function privateOutput(path) {
  const target = resolve(await realpath(dirname(resolve(path))), basename(path));
  let ancestor = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  while (true) {
    const hasGit = await lstat(resolve(ancestor, ".git")).then(() => true, () => false);
    const child = relative(ancestor, target);
    if (hasGit && (child === "" || (child !== ".." && !child.startsWith("../") && !isAbsolute(child)))) throw new Error("Output must be outside repository");
    const next = dirname(ancestor);
    if (next === ancestor) break;
    ancestor = next;
  }
  const file = await open(target, "wx", 0o600);
  await file.chmod(0o600);
  return file;
}

export function mapLegacyUsers(rows, mapping, ownerEmail) {
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) throw new Error("Invalid mapping");
  if (!ownerEmail || rows.filter((row) => row.email?.trim().toLowerCase() === ownerEmail.trim().toLowerCase()).length !== 1) throw new Error("Owner must match exactly one legacy user");
  const roles = new Set(["admin", "calisan", "kargo_operatoru"]);
  const mapped = rows.map((row) => {
    if (!roles.has(row.role_name)) throw new Error("Unknown legacy role");
    const publicId = mapping[row.id];
    if (typeof publicId !== "string" || !/^usr_[a-f0-9]+$/.test(publicId)) throw new Error("Missing or invalid mapped public id");
    if (typeof row.aktif !== "boolean") throw new Error("Invalid active flag");
    return {
      public_id: publicId, email: row.email.trim().toLowerCase(),
      first_name: row.ad ?? "", last_name: row.soyad ?? "", phone: row.telefon,
      role: row.email.trim().toLowerCase() === ownerEmail.trim().toLowerCase() ? "owner" : row.role_name,
      is_active: row.aktif, sip_username: row.sip_kullanici_adi || null,
      sip_password: row.sip_sifre || null, sip_extension: row.sip_dahili == null ? null : String(row.sip_dahili),
    };
  });
  if (new Set(mapped.map((user) => user.public_id)).size !== mapped.length ||
      new Set(mapped.map((user) => user.email)).size !== mapped.length || Object.keys(mapping).length !== rows.length) throw new Error("Identity mapping mismatch");
  return mapped;
}

async function main() {
  const { values } = parseArgs({ options: { output: { type: "string" }, "owner-email": { type: "string" } } });
  if (!values.output || !values["owner-email"] || !process.env.SOURCE_DATABASE_URL || !process.env.MIGRATION_USER_PUBLIC_IDS_FILE) throw new Error("Missing configuration");
  const url = new URL(process.env.SOURCE_DATABASE_URL);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Only a local legacy copy is allowed");
  // Ignore query parameters so neither host nor read-only options can be overridden.
  url.search = "";
  const client = new pg.Client({ connectionString: url.toString(), options: "-c default_transaction_read_only=on" });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const { rows } = await client.query(`SELECT k.id, k.email, k.ad, k.soyad, k.telefon, k.aktif,
      k.sip_kullanici_adi, k.sip_sifre, k.sip_dahili, r.ad AS role_name
      FROM kullanicilar k LEFT JOIN roller r ON r.id = k.rol_id ORDER BY k.id`);
    const mapping = JSON.parse(await readFile(process.env.MIGRATION_USER_PUBLIC_IDS_FILE, "utf8"));
    const users = mapLegacyUsers(rows, mapping, values["owner-email"]);
    await client.query("ROLLBACK");
    const file = await privateOutput(values.output);
    try { await file.writeFile(JSON.stringify(users, null, 2) + "\n"); await file.sync(); }
    finally { await file.close(); }
    console.log(`Exported ${users.length} users (${users.filter((user) => user.is_active).length} active)`);
  } finally { await client.end(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error("Legacy export failed; check local connection, roles, mapping, owner and output path"); process.exitCode = 1; });
}
