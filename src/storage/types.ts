/** Where export_activity_file writes (spec §5.6). Left unset, the tool doesn't exist. */
export interface ExportStorage {
  /** Writes (or overwrites) one file and returns where it landed, as an absolute path. */
  write(fileName: string, contents: Uint8Array | string): Promise<string>;
}
