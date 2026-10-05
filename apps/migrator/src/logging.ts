import { createStructuredLog } from "@garanti-kulucka/shared";
import type { MigratorCommand } from "./commands.js";
import { toSafeMigratorError } from "./errors.js";

export interface MigratorFailureLogPayload {
  readonly command: MigratorCommand;
  readonly reportFile: string | undefined;
  readonly error: {
    readonly name: string;
    readonly message: string;
  };
}

export function createMigratorFailureLogPayload(
  error: unknown,
  command: MigratorCommand,
  reportFile: string | undefined,
): MigratorFailureLogPayload & ReturnType<typeof createStructuredLog> {
  const safeError = toSafeMigratorError(error);
  const safeLogError = {
    name: safeError.name,
    message: safeError.message,
  };

  return {
    command,
    reportFile,
    error: safeLogError,
    ...createStructuredLog({
      level: "error",
      service: "migrator",
      event: "migrator.command_failed",
      msg: "Migrator command failed",
      context: {
        command,
        reportFile,
        error: safeLogError,
      },
    }),
  };
}
