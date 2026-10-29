import type { RouvyClient } from "../rouvy/client.js";
import { dropEmpty, workoutUrl } from "./common.js";

export interface ListWorkoutsInput {
  limit: number;
  offset: number;
}

/** The rider's own Workouts as compact rows, never with their Steps. One request, cached for 60 s. */
export async function listWorkouts(rouvy: RouvyClient, { limit, offset }: ListWorkoutsInput) {
  const { workouts, itemsCount } = await rouvy.listWorkouts();
  const rows = workouts.slice(offset, offset + limit).map((workout) =>
    dropEmpty({
      id: workout.id,
      url: workoutUrl(workout.id),
      name: workout.name,
      duration_sec: workout.duration,
      tss: workout.tss,
      difficulty: workout.difficulty,
      tags: workout.trainingEffects,
      step_count: workout.segments.length,
    }),
  );
  // Rouvy's `created` collection has never been seen paginating (spec-m3 §3): if it ever does,
  // say so rather than hide Workouts.
  const notes =
    itemsCount > workouts.length
      ? [`Rouvy returned ${workouts.length} of the ${itemsCount} Workouts in your library; the others can't be reached yet.`]
      : [];
  return {
    workouts: rows,
    has_more: offset + limit < workouts.length,
    ...(notes.length > 0 && { notes }),
  };
}
