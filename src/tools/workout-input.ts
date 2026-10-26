import { z } from "zod";
import type { WorkoutForm } from "../rouvy/workout-writes.js";
import {
  flattenSteps,
  MAX_TAGS,
  TAGS,
  toInstructions,
  toSegments,
  VISIBILITIES,
  workoutProblems,
  type WorkoutContent,
} from "../workouts/steps.js";
import { InputError } from "./errors.js";

/*
 * The shapes a Workout tool takes (spec-m3 §5). Ranges and cross-field rules aren't in the schema:
 * `toWorkoutForm` checks them all at once, so one error lists every problem with its path.
 */

const cadence = z
  .object({
    min_rpm: z.number().describe("rpm, 0–300"),
    max_rpm: z.number().describe("rpm, 0–300, at least min_rpm"),
  })
  .describe("An optional cadence range.");

const durationSec = z.number().describe("Seconds, a whole number, at least 1.");
const ftpPct = (what: string) => z.number().describe(`${what}, in % FTP: a whole number, 0–300.`);

const steady = z.object({
  type: z.literal("steady"),
  duration_sec: durationSec,
  ftp_pct: ftpPct("The target"),
  cadence: cadence.optional(),
});
const ramp = z.object({
  type: z.literal("ramp"),
  duration_sec: durationSec,
  from_ftp_pct: ftpPct("The start"),
  to_ftp_pct: ftpPct("The end"),
  cadence: cadence.optional(),
});
const freeRide = z.object({ type: z.literal("free_ride"), duration_sec: durationSec, cadence: cadence.optional() });
const simpleStep = z.discriminatedUnion("type", [steady, ramp, freeRide]);
const repeat = z.object({
  type: z.literal("repeat"),
  times: z.number().describe("How many times, a whole number, at least 2."),
  steps: z.array(simpleStep).describe("The Steps to repeat, in order. No repeat inside a repeat."),
});

export const stepsInput = z
  .array(z.discriminatedUnion("type", [steady, ramp, freeRide, repeat]))
  .describe("The Steps in order, at least 30 s in all. A repeat is flattened: Rouvy stores and returns flat Steps.");

export const cuesInput = z
  .array(
    z.object({
      at_sec: z.number().describe("When it shows, in seconds from the Workout's start (before its end)."),
      text: z.string().describe("The text shown to the rider."),
      show_sec: z.number().optional().describe("How long it shows, in seconds (default 15)."),
    }),
  )
  .describe("Text Cues shown during the Workout.");

export const nameInput = z.string().describe("1–200 characters.");
export const descriptionInput = z.string().describe("Free text.");
export const tagsInput = z.array(z.enum(TAGS)).describe(`Training effects, at most ${MAX_TAGS}.`);
export const visibilityInput = z.enum(VISIBILITIES).describe("private (the default), or public only when the rider asks.");

/** Checks every rule before any request, then maps to Rouvy's form fields. */
export function toWorkoutForm(content: WorkoutContent): WorkoutForm {
  const problems = workoutProblems(content);
  if (problems.length > 0) throw new InputError(`Invalid Workout:\n${problems.map((p) => `- ${p}`).join("\n")}`);
  return {
    name: content.name,
    description: content.description ?? "",
    tags: content.tags,
    access: content.visibility === "public" ? "PUBLIC" : "PRIVATE",
    segments: toSegments(flattenSteps(content.steps)),
    instructions: toInstructions(content.cues),
  };
}
