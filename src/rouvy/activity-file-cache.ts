import type { DownloadedActivityFile } from "./client.js";

/** About 20 Activity files (a few hundred KB each, parsed, plus their bytes) is plenty for one conversation. */
const MAX_ACTIVITY_FILES = 20;

/**
 * Parsed Activity files, in memory, keyed by uid so another account never sees them.
 * An Activity file is written once at upload and never changes, so entries never expire:
 * the least recently used one is evicted instead.
 */
export function createActivityFileCache() {
  const entries = new Map<string, DownloadedActivityFile>();
  const key = (uid: string, activityId: string) => `${uid}\n${activityId}`;

  return {
    get(uid: string, activityId: string): DownloadedActivityFile | undefined {
      const file = entries.get(key(uid, activityId));
      if (file) {
        // Map keeps insertion order: re-inserting makes this the most recently used.
        entries.delete(key(uid, activityId));
        entries.set(key(uid, activityId), file);
      }
      return file;
    },
    set(uid: string, activityId: string, file: DownloadedActivityFile) {
      entries.delete(key(uid, activityId));
      entries.set(key(uid, activityId), file);
      while (entries.size > MAX_ACTIVITY_FILES) entries.delete(entries.keys().next().value!);
    },
  };
}
