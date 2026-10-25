import type { Clock } from "./clock.js";
import type { ActivityDetail } from "./schemas.js";

/** RPE and validation status can still change after the Activity is uploaded, so details don't live long. */
const DETAIL_TTL_MS = 10 * 60_000;

/** Activity details, in memory, keyed by uid so another account never sees them. */
export function createDetailCache(clock: Clock) {
  const entries = new Map<string, { detail: ActivityDetail; fetchedAt: number }>();
  const key = (uid: string, activityId: string) => `${uid}\n${activityId}`;

  return {
    get(uid: string, activityId: string): ActivityDetail | undefined {
      const entry = entries.get(key(uid, activityId));
      if (entry && clock.now() - entry.fetchedAt < DETAIL_TTL_MS) return entry.detail;
      entries.delete(key(uid, activityId));
      return undefined;
    },
    set(uid: string, activityId: string, detail: ActivityDetail) {
      entries.set(key(uid, activityId), { detail, fetchedAt: clock.now() });
    },
  };
}
