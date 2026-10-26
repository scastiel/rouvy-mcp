import { z } from "zod";
import { apiChanged } from "./errors.js";
import { describePath } from "./schemas.js";

export const WORKOUT_LIST_ROUTE = "routes/_main.workouts.collections.$id";
export const WORKOUT_DETAIL_ROUTE = "routes/_main.workouts.$id";

/** One stretch of a Workout, as Rouvy reads it back (spec-m3 §3). Writes use other names. */
const segment = z.object({
  duration: z.number(),
  intervalType: z.enum(["CONSTANT", "RAMP", "FREE_RIDE"]),
  // "FTP" for everything the creator writes; imported files may carry other target kinds.
  type: z.string(),
  valueStart: z.number(),
  valueEnd: z.number(),
  secondaryType: z.string().nullish(),
  secondaryMin: z.number().nullish(),
  secondaryMax: z.number().nullish(),
});

/** What the `created` list and a detail share. The list has no `if` and no `access`. */
const workoutOverview = z.object({
  id: z.string(),
  name: z.string(),
  duration: z.number(),
  tss: z.number().nullish(),
  difficulty: z.string().nullish(),
  trainingEffects: z.array(z.string()),
  segments: z.array(segment),
});

const workoutListPayload = z.object({
  [WORKOUT_LIST_ROUTE]: z.object({
    data: z.object({ collection: z.object({ itemsCount: z.number(), workouts: z.array(workoutOverview) }) }),
  }),
});

const workoutDetail = z.object({
  workout: workoutOverview.extend({
    // The owner: compared with the Session's uid (spec-m3 §6.3). Never shown.
    createdBy: z.object({ firebaseUid: z.string() }),
    description: z.string().nullish(),
    if: z.number().nullish(),
    access: z.enum(["PRIVATE", "PUBLIC"]),
    instructions: z.array(z.object({ text: z.string(), showDuration: z.number(), durationFromStart: z.number() })),
    recommendedRoute: z.object({ id: z.string(), name: z.string().nullish() }).nullish(),
    // The rider's current Rider settings, as Rouvy attaches them to every Workout.
    userMetrics: z.object({ userFtp: z.number().nullish() }).nullish(),
  }),
});

const workoutDetailPayload = z.object({ [WORKOUT_DETAIL_ROUTE]: z.object({ data: workoutDetail }) });

export type WorkoutSegment = z.infer<typeof segment>;
export type WorkoutOverview = z.infer<typeof workoutOverview>;
export type WorkoutList = { itemsCount: number; workouts: WorkoutOverview[] };
export type WorkoutDetail = z.infer<typeof workoutDetail>["workout"];

/** The rider's `created` collection, in Rouvy's order (newest first). */
export function parseWorkoutList(payload: unknown): WorkoutList {
  const result = workoutListPayload.safeParse(payload);
  if (!result.success) throw apiChanged(WORKOUT_LIST_ROUTE, describePath(result.error.issues[0]?.path.slice(2) ?? []));
  return result.data[WORKOUT_LIST_ROUTE].data.collection;
}

export const WORKOUT_CREATOR_ROUTE = "routes/_main.workouts.create";

/** The creator's loader: only the route it pre-fills for a new Workout is read. */
const workoutCreatorPayload = z.object({
  [WORKOUT_CREATOR_ROUTE]: z.object({ data: z.object({ route: z.object({ id: z.string() }) }) }),
});

export function parseDefaultRouteId(payload: unknown): string {
  const result = workoutCreatorPayload.safeParse(payload);
  if (!result.success) throw apiChanged(WORKOUT_CREATOR_ROUTE, describePath(result.error.issues[0]?.path.slice(2) ?? []));
  return result.data[WORKOUT_CREATOR_ROUTE].data.route.id;
}

export function parseWorkoutDetail(payload: unknown): WorkoutDetail {
  const result = workoutDetailPayload.safeParse(payload);
  if (!result.success) throw apiChanged(WORKOUT_DETAIL_ROUTE, describePath(result.error.issues[0]?.path.slice(2) ?? []));
  return result.data[WORKOUT_DETAIL_ROUTE].data.workout;
}
