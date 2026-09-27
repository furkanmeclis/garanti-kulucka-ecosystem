export type MigratorCommand = "migrate:dry-run" | "migrate:apply" | "verify";

export function parseMigratorCommand(args: string[]): MigratorCommand {
  const [command, flag] = args;

  if (command === "verify") return "verify";
  if (command === "migrate" && flag === "--dry-run") return "migrate:dry-run";
  if (command === "migrate" && flag === "--apply") return "migrate:apply";

  throw new Error("Usage: garanti-migrator migrate --dry-run | migrate --apply | verify");
}
