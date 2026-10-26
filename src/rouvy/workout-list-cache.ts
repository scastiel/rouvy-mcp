import type { Clock } from "./clock.js";
import type { WorkoutList } from "./workout-schemas.js";

const WORKOUT_LIST_TTL_MS = 60_000;

/** The rider's `created` collection, in memory, keyed by uid so another account never sees it. */
export function createWorkoutListCache(clock: Clock) {
  const entries = new Map<string, { list: WorkoutList; fetchedAt: number }>();

  return {
    get(uid: string): WorkoutList | undefined {
      const entry = entries.get(uid);
      return entry && clock.now() - entry.fetchedAt < WORKOUT_LIST_TTL_MS ? entry.list : undefined;
    },
    set(uid: string, list: WorkoutList) {
      entries.set(uid, { list, fetchedAt: clock.now() });
    },
    drop(uid: string) {
      entries.delete(uid);
    },
  };
}
