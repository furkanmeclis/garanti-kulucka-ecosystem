import type { SourceDatabaseIdentity } from "./types.js";

export type PostgresDatabaseIdentity = SourceDatabaseIdentity;

const postgresProtocols = new Set(["postgres:", "postgresql:"]);

export function normalizePostgresDatabaseIdentity(connectionString: string): PostgresDatabaseIdentity {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("Database URL must be a valid PostgreSQL connection URL");
  }

  if (!postgresProtocols.has(url.protocol)) {
    throw new Error("Database URL must use the postgres or postgresql protocol");
  }

  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (!url.hostname || !database) {
    throw new Error("Database URL must include a host and database name");
  }

  return {
    host: url.hostname.toLowerCase().replace(/\.$/, ""),
    port: url.port || "5432",
    database,
  };
}

export function assertDistinctPostgresDatabases(sourceUrl: string, targetUrl: string): void {
  const source = normalizePostgresDatabaseIdentity(sourceUrl);
  const target = normalizePostgresDatabaseIdentity(targetUrl);

  if (databaseIdentityKey(source) === databaseIdentityKey(target)) {
    throw new Error("Source and target database identities must be different");
  }
}

function databaseIdentityKey(identity: PostgresDatabaseIdentity): string {
  return `${identity.host}:${identity.port}/${identity.database}`;
}
