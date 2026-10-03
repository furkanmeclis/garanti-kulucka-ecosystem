const postgresUrlPattern = /\bpostgres(?:ql)?:\/\/[^\s"'<>]+/giu;
const secretParameterPattern = /\b(password|pass|pwd|token|access_token|connectionString)=([^\s;,&]+)/giu;
const quotedSecretParameterPattern =
  /\b(password|pass|pwd|token|access_token|connectionString)=("[^"]*"|'[^']*')/giu;
const authorizationHeaderPattern = /\bauthorization\s*[:=]\s*(bearer|basic)\s+[^\s;,]+/giu;

export const migrationApplyDisabledMessage =
  "migrate --apply is disabled until the legacy-to-canonical field and relationship mapping catalog is configured";

export function sanitizeMigratorErrorMessage(message: string): string {
  return message
    .replace(postgresUrlPattern, "[REDACTED_DATABASE_URL]")
    .replace(quotedSecretParameterPattern, "$1=[REDACTED]")
    .replace(authorizationHeaderPattern, "authorization=[REDACTED]")
    .replace(secretParameterPattern, "$1=[REDACTED]");
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
