import type { WorkoutWriter } from "../rouvy/workout-writes.js";
import { workoutProblems, type WorkoutContent } from "../workouts/steps.js";
import { InputError } from "./errors.js";
import { invalidWorkout, toWorkoutForm } from "./workout-input.js";
import { toWorkoutResult } from "./workout-shape.js";

export type UpdateWorkoutInput = Partial<Omit<WorkoutContent, "description">> & { workout_id: string; description?: string };

/**
 * Changes what's given and keeps everything else as it is in Rouvy right now (spec-m3 §4): `steps`
 * replace all Steps, left-out `cues` are kept, the route is never changed.
 */
export async function updateWorkout(writer: WorkoutWriter, { workout_id, ...changes }: UpdateWorkoutInput) {
  checkGivenFields(changes);
  const saved = await writer.update(workout_id, (current) => {
    const now = toWorkoutResult(current) as unknown as WorkoutContent;
    // Rouvy keeps a Workout's tags when an edit sends none (spec-m3 §3): say so rather than pretend.
    if (changes.tags?.length === 0 && now.tags.length > 0) {
      throw new InputError("Rouvy can't remove every tag from a Workout: give the tags to keep (at least one), or leave tags out.");
    }
    return toWorkoutForm({
      name: changes.name ?? now.name,
      description: changes.description ?? now.description ?? "",
      tags: changes.tags ?? now.tags,
      visibility: changes.visibility ?? now.visibility,
      steps: changes.steps ?? now.steps,
      cues: changes.cues ?? now.cues,
    });
  });
  return toWorkoutResult(saved);
}

/**
 * The fields given, on their own, before any request. Left-out Steps stand in as one Step long
 * enough for any Cue: Cues are checked against the real total once the Workout has been read.
 */
function checkGivenFields(changes: Omit<UpdateWorkoutInput, "workout_id">) {
  const problems = workoutProblems({
    name: changes.name ?? "unchanged",
    tags: changes.tags ?? [],
    visibility: "private",
    steps: changes.steps ?? [{ type: "free_ride", duration_sec: Number.MAX_SAFE_INTEGER }],
    cues: changes.cues ?? [],
  });
  if (problems.length > 0) throw invalidWorkout(problems);
}
