import { lstat, open, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Resolve parents to prevent a symlink from redirecting a secret file into a checkout. */
export async function openPrivateOutput(path: string) {
  const parent = await realpath(dirname(resolve(path)));
  const target = resolve(parent, basename(path));
  let ancestor = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  while (true) {
    const hasGit = await lstat(resolve(ancestor, ".git")).then(() => true, () => false);
    const child = relative(ancestor, target);
    if (hasGit && (child === "" || (child !== ".." && !child.startsWith("../") && !isAbsolute(child)))) {
      throw new Error("Secret output must be outside the repository");
    }
    const next = dirname(ancestor);
    if (next === ancestor) break;
    ancestor = next;
  }
  const handle = await open(target, "wx", 0o600);
  await handle.chmod(0o600);
  return handle;
}
