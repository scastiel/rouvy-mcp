import type { Clock } from "./clock.js";
import type { ActivityListRow } from "./schemas.js";

const LIST_PAGE_TTL_MS = 60_000;

/**
 * Activity list pages, in memory, keyed by uid so another account never sees them.
 * A new Activity shifts every offset by one, so when page 0 comes back with a different
 * first Activity, every page of that rider is dropped together.
 */
export function createListCache(clock: Clock) {
  const pages = new Map<string, { rows: ActivityListRow[]; fetchedAt: number }>();
  const newestId = new Map<string, string | undefined>();
  const key = (uid: string, offset: number) => `${uid}\n${offset}`;

  return {
    get(uid: string, offset: number): ActivityListRow[] | undefined {
      const entry = pages.get(key(uid, offset));
      return entry && clock.now() - entry.fetchedAt < LIST_PAGE_TTL_MS ? entry.rows : undefined;
    },
    set(uid: string, offset: number, rows: ActivityListRow[]) {
      if (offset === 0) {
        const first = rows[0]?.id;
        if (newestId.has(uid) && newestId.get(uid) !== first) {
          for (const k of pages.keys()) if (k.startsWith(`${uid}\n`)) pages.delete(k);
        }
        newestId.set(uid, first);
      }
      pages.set(key(uid, offset), { rows, fetchedAt: clock.now() });
    },
  };
}
