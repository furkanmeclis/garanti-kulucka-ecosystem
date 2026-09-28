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
): MigratorFailureLogPayload {
  const safeError = toSafeMigratorError(error);

  return {
    command,
    reportFile,
    error: {
      name: safeError.name,
      message: safeError.message,
    },
  };
}
