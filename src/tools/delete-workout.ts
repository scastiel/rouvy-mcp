import type { WorkoutWriter } from "../rouvy/workout-writes.js";

export async function deleteWorkout(writer: WorkoutWriter, { workout_id }: { workout_id: string }) {
  const { name } = await writer.delete(workout_id);
  return {
    deleted: workout_id,
    name,
    note: "Gone from your library. Rouvy may keep it readable by its id, but it no longer lists it anywhere.",
  };
}
