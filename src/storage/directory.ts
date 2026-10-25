import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { writePrivateFile } from "../private-file.js";
import type { ExportStorage } from "./types.js";

/** Exports into one local folder (ROUVY_MCP_EXPORT_DIR), created on the first export. */
export function createDirectoryStorage(dir: string): ExportStorage {
  return {
    async write(fileName, contents) {
      await mkdir(dir, { recursive: true });
      const path = resolve(join(dir, fileName));
      await writePrivateFile(path, contents);
      return path;
    },
  };
}
