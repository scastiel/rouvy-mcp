import type { WorkoutWriter } from "../rouvy/workout-writes.js";
import type { WorkoutContent } from "../workouts/steps.js";
import { toWorkoutForm } from "./workout-input.js";
import { toWorkoutResult } from "./workout-shape.js";

export type CreateWorkoutInput = Omit<WorkoutContent, "tags" | "visibility" | "cues"> &
  Partial<Pick<WorkoutContent, "tags" | "visibility" | "cues">> & { route_id?: string };

export async function createWorkout(writer: WorkoutWriter, { route_id, ...input }: CreateWorkoutInput) {
  const form = toWorkoutForm({ ...input, tags: input.tags ?? [], visibility: input.visibility ?? "private", cues: input.cues ?? [] });
  return toWorkoutResult(await writer.create(form, route_id));
}
