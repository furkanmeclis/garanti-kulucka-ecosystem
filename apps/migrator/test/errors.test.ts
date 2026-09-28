import { describe, expect, it } from "vitest";
import { toSafeMigratorError } from "../src/errors.js";
import { createMigratorFailureLogPayload } from "../src/logging.js";

describe("migrator error safety", () => {
  it("creates a new error without copying enumerable secrets when the message is unchanged", () => {
    const original = Object.assign(new Error("connection failed"), {
      connectionString: "postgres://admin:database-secret@db.internal/legacy",
      password: "database-secret",
      token: "provider-secret",
      cause: new Error("upstream provider-secret"),
    });

    const safeError = toSafeMigratorError(original);

    expect(safeError).not.toBe(original);
    expect(safeError).toEqual(expect.objectContaining({ name: "Error", message: "connection failed" }));
    expect(Object.keys(safeError)).toEqual([]);
    expect(safeError).not.toHaveProperty("cause");
    expect(JSON.stringify(safeError)).not.toContain("secret");
  });

  it("builds an allowlisted logger payload from a secret-bearing error", () => {
    const original = Object.assign(new Error("request failed token=provider-secret"), {
      connectionString: "postgres://admin:database-secret@db.internal/legacy",
      password: "database-secret",
      token: "provider-secret",
      cause: new Error("provider-secret"),
    });
    original.name = "DatabaseError password=database-secret";

    const payload = createMigratorFailureLogPayload(
      original,
      "migrate:dry-run",
      "reports/dry-run.json",
    );

    expect(payload).toEqual({
      command: "migrate:dry-run",
      reportFile: "reports/dry-run.json",
      error: {
        name: "DatabaseError password=[REDACTED]",
        message: "request failed token=[REDACTED]",
      },
    });
    expect(Object.keys(payload.error)).toEqual(["name", "message"]);
    expect(JSON.stringify(payload)).not.toContain("secret");
    expect(JSON.stringify(payload)).not.toContain("connectionString");
    expect(JSON.stringify(payload)).not.toContain("cause");
  });
});
