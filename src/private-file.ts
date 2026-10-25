import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";

/**
 * Writes a file only the user can read. A fresh 0600 temp file is renamed into place, so the
 * contents never sit in a file with looser permissions, not even an older one being overwritten.
 * The temp name is unique per write, so two writes of the same file never share one.
 */
export async function writePrivateFile(path: string, contents: Uint8Array | string): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, contents, { mode: 0o600 });
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}
