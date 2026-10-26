import type { RouvyClient } from "../rouvy/client.js";
import { toWorkoutResult } from "./workout-shape.js";

export async function getWorkout(rouvy: RouvyClient, { workout_id }: { workout_id: string }) {
  return toWorkoutResult(await rouvy.getOwnedWorkout(workout_id));
}
