import { mkdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ExportStorage } from "./types.js";

/** Exports into one local folder (ROUVY_MCP_EXPORT_DIR), created on the first export. */
export function createDirectoryStorage(dir: string): ExportStorage {
  return {
    async write(fileName, contents) {
      await mkdir(dir, { recursive: true });
      const path = resolve(join(dir, fileName));
      // A fresh 0600 file renamed into place: an overwrite never keeps an older file's looser permissions.
      const temp = `${path}.${process.pid}.tmp`;
      await writeFile(temp, contents, { mode: 0o600 });
      await rename(temp, path);
      return path;
    },
  };
}
