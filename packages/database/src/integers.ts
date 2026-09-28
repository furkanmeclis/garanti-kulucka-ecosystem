import { types } from "pg";

const postgresInt8Oid = 20;
let safeIntegerParsersInstalled = false;

export function parseSafePostgresInt8(value: string): number {
  if (!/^-?\d+$/.test(value)) {
    throw new TypeError(`Invalid PostgreSQL int8 value: ${value}`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError(`PostgreSQL int8 value is outside JavaScript safe integer range: ${value}`);
  }

  return parsed;
}

export function installSafeIntegerTypeParsers(): void {
  if (safeIntegerParsersInstalled) return;
  types.setTypeParser(postgresInt8Oid, parseSafePostgresInt8);
  safeIntegerParsersInstalled = true;
}
