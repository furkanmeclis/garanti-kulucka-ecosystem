import { redactValue } from "@garanti-kulucka/shared";

const postgresUrlPattern = /\bpostgres(?:ql)?:\/\/[^\s"'<>]+/giu;

export const migrationApplyDisabledMessage =
  "migrate --apply is disabled until the legacy-to-canonical field and relationship mapping catalog is configured";

export function sanitizeMigratorErrorMessage(message: string): string {
  return String(redactValue(message.replace(postgresUrlPattern, "[REDACTED_DATABASE_URL]")))
    .replaceAll("[redacted]", "[REDACTED]");
}

export function toSafeMigratorError(error: unknown): Error {
  const safeError = new Error(
    error instanceof Error
      ? sanitizeMigratorErrorMessage(error.message)
      : "Unknown migrator error",
  );
  const safeName = error instanceof Error
    ? sanitizeMigratorErrorMessage(error.name || "Error")
    : "Error";

  Object.defineProperty(safeError, "name", {
    configurable: true,
    value: safeName,
    writable: true,
  });

  return safeError;
}
