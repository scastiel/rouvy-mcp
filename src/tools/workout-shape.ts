import { unsupportedWorkout } from "../rouvy/errors.js";
import type { WorkoutDetail, WorkoutSegment } from "../rouvy/workout-schemas.js";
import { dropEmpty, workoutUrl } from "./common.js";

/**
 * A Workout as every Workout tool returns it (spec-m3 §4): flat Steps and absolute Cues, the same
 * shapes `update_workout` takes, so a result passed back unchanged round-trips.
 */
export function toWorkoutResult(workout: WorkoutDetail) {
  return dropEmpty({
    id: workout.id,
    url: workoutUrl(workout.id),
    name: workout.name,
    description: workout.description,
    tags: workout.trainingEffects,
    visibility: workout.access === "PUBLIC" ? "public" : "private",
    duration_sec: workout.duration,
    tss: workout.tss,
    if: workout.if,
    difficulty: workout.difficulty,
    route: workout.recommendedRoute && { id: workout.recommendedRoute.id, name: workout.recommendedRoute.name },
    rider_ftp_w: workout.userMetrics?.userFtp,
    steps: workout.segments.map(toStep),
    cues: workout.instructions.map((cue) => ({ at_sec: cue.durationFromStart, text: cue.text, show_sec: cue.showDuration })),
  });
}

function toStep(segment: WorkoutSegment) {
  if (segment.type !== "FTP") throw unsupportedWorkout();
  const duration_sec = segment.duration;
  const cadence =
    segment.secondaryType === "CADENCE" ? { min_rpm: segment.secondaryMin, max_rpm: segment.secondaryMax } : undefined;
  switch (segment.intervalType) {
    case "CONSTANT":
      return { type: "steady", duration_sec, ftp_pct: segment.valueStart, cadence };
    case "RAMP":
      return { type: "ramp", duration_sec, from_ftp_pct: segment.valueStart, to_ftp_pct: segment.valueEnd, cadence };
    case "FREE_RIDE":
      return { type: "free_ride", duration_sec, cadence };
  }
}
