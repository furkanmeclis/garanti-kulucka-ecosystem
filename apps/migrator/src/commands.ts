import { spawn } from "node:child_process";
import { Client } from "pg";

export type MigratorCommand = "migrate:dry-run" | "migrate:apply" | "verify";

export function parseMigratorCommand(args: string[]): MigratorCommand {
  const [command, flag] = args;

  if (command === "verify") return "verify";
  if (command === "migrate" && flag === "--dry-run") return "migrate:dry-run";
  if (command === "migrate" && flag === "--apply") return "migrate:apply";

  throw new Error("Usage: garanti-migrator migrate --dry-run | migrate --apply | verify");
}

export async function runMigratorCommand(command: MigratorCommand, env = process.env): Promise<void> {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  if (command === "verify") {
    await verifyTargetDatabase(databaseUrl);
    return;
  }

  const args = [
    "node_modules/node-pg-migrate/bin/node-pg-migrate.js",
    "up",
    "--migrations-dir",
    "packages/database/migrations",
    "--database-url",
    databaseUrl,
  ];

  if (command === "migrate:dry-run") {
    args.push("--dry-run");
  }

  await runNodeCommand(args);
}

async function runNodeCommand(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with exit code ${code ?? "unknown"}`));
    });
  });
}

async function verifyTargetDatabase(databaseUrl: string): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const requiredTables = [
      "users",
      "roles",
      "customers",
      "conversations",
      "messages",
      "orders",
      "shipments",
      "integration_providers",
      "integration_accounts",
      "settings",
      "legacy_id_map",
    ];

    const result = await client.query<{ table_name: string }>(
      `
        select table_name
        from information_schema.tables
        where table_schema = 'public'
          and table_name = any($1::text[])
      `,
      [requiredTables],
    );

    const existing = new Set(result.rows.map((row) => row.table_name));
    const missing = requiredTables.filter((table) => !existing.has(table));

    if (missing.length > 0) {
      throw new Error(`Missing canonical tables: ${missing.join(", ")}`);
    }
  } finally {
    await client.end();
  }
}
