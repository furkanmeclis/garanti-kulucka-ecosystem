import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Client } from "pg";
import type { MigratorCommandReport, MigratorCommandReportError } from "./types.js";

export type MigratorCommand = "migrate:dry-run" | "migrate:apply" | "verify";

export interface ParsedMigratorCommand {
  readonly command: MigratorCommand;
  readonly options: MigratorCommandOptions;
}

export interface MigratorCommandOptions {
  readonly reportFile?: string;
}

export function parseMigratorCommand(args: string[]): MigratorCommand {
  return parseMigratorCliCommand(args).command;
}

export function parseMigratorCliCommand(args: string[]): ParsedMigratorCommand {
  const [command, flag, ...rest] = args;
  const options = parseMigratorOptions(command === "verify" ? [flag, ...rest] : rest);

  if (command === "verify") return { command: "verify", options };
  if (command === "migrate" && flag === "--dry-run") return { command: "migrate:dry-run", options };
  if (command === "migrate" && flag === "--apply") return { command: "migrate:apply", options };

  throw new Error(usage);
}

export async function runMigratorCommand(
  command: MigratorCommand,
  env = process.env,
  options: MigratorCommandOptions = {},
): Promise<void> {
  const startedAt = new Date();

  try {
    const databaseUrl = env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }

    if (command === "verify") {
      await verifyTargetDatabase(databaseUrl);
      await writeMigratorCommandReport(options, createCommandReport(command, "passed", startedAt));
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
    await writeMigratorCommandReport(options, createCommandReport(command, "passed", startedAt));
  } catch (error) {
    await writeMigratorCommandReport(options, createCommandReport(command, "failed", startedAt, error));
    throw error;
  }
}

function parseMigratorOptions(args: (string | undefined)[]): MigratorCommandOptions {
  const options: { reportFile?: string } = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;

    if (arg !== "--report-file") {
      throw new Error(usage);
    }

    const reportFile = args[index + 1];
    if (!reportFile || reportFile.startsWith("--")) {
      throw new Error("--report-file requires a path");
    }

    options.reportFile = reportFile;
    index += 1;
  }

  return options;
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

async function writeMigratorCommandReport(
  options: MigratorCommandOptions,
  report: MigratorCommandReport,
): Promise<void> {
  if (!options.reportFile) {
    return;
  }

  await mkdir(dirname(options.reportFile), { recursive: true });
  await writeFile(options.reportFile, `${JSON.stringify(report, null, 2)}\n`);
}

function createCommandReport(
  command: MigratorCommand,
  status: MigratorCommandReport["status"],
  startedAt: Date,
  error?: unknown,
): MigratorCommandReport {
  const finishedAt = new Date();
  return {
    command,
    status,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    ...(error ? { error: createReportError(error) } : {}),
  };
}

function createReportError(error: unknown): MigratorCommandReportError {
  if (error instanceof Error) {
    return { message: error.message };
  }

  return { message: "Unknown migrator error" };
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

const usage =
  "Usage: garanti-migrator migrate --dry-run [--report-file path] | migrate --apply [--report-file path] | verify [--report-file path]";
