/** Rouvy's training-effect slugs, as its creator lists them (spec-m3 §5). */
export const TAGS = [
  "mental-health",
  "endurance",
  "vo2-max",
  "recovery",
  "climbing",
  "sweet-spot-tempo",
  "threshold",
  "anaerobic",
  "strength",
  "cadence",
  "sprinting",
  "warm-up",
  "cool-down",
] as const;

export const VISIBILITIES = ["private", "public"] as const;

export const MAX_TAGS = 3;
const MAX_NAME_LENGTH = 200;
const MIN_TOTAL_SEC = 30;
const MAX_FTP_PCT = 300;
const MAX_RPM = 300;
const DEFAULT_SHOW_SEC = 15;

export interface Cadence {
  min_rpm: number;
  max_rpm: number;
}

export type Step =
  | { type: "steady"; duration_sec: number; ftp_pct: number; cadence?: Cadence }
  | { type: "ramp"; duration_sec: number; from_ftp_pct: number; to_ftp_pct: number; cadence?: Cadence }
  | { type: "free_ride"; duration_sec: number; cadence?: Cadence };

/** What a tool takes: a Step, or `repeat`, input sugar that never comes back on read. */
export type InputStep = Step | { type: "repeat"; times: number; steps: InputStep[] };

export interface Cue {
  at_sec: number;
  text: string;
  show_sec?: number;
}

/** A Workout as the rider describes it, before any request. */
export interface WorkoutContent {
  name: string;
  description?: string;
  tags: readonly string[];
  visibility: (typeof VISIBILITIES)[number];
  steps: InputStep[];
  cues: Cue[];
}

/** One segment as Rouvy's form takes it (spec-m3 §3): not the names it reads back with. */
export interface WriteSegment {
  duration: number;
  intervalType: "CONSTANT" | "RAMP" | "FREE_RIDE";
  primaryStart: number;
  primaryEnd: number;
  primaryType: "FTP";
  secondaryMin: number | null;
  secondaryMax: number | null;
  secondaryType: "CADENCE" | null;
}

export interface WriteInstruction {
  text: string;
  showDuration: number;
  durationFromStart: number;
}

/** `times` × its Steps, in order. A Step inside a nested `repeat` is never produced: that's an input error. */
export function flattenSteps(steps: InputStep[]): Step[] {
  return steps.flatMap((step) =>
    step.type === "repeat" ? Array.from({ length: step.times }, () => step.steps as Step[]).flat() : [step],
  );
}

/**
 * Every rule of spec-m3 §5, each problem with its path (`steps[2].steps[0].ftp_pct`). Empty when
 * the Workout can be sent.
 */
export function workoutProblems(workout: WorkoutContent): string[] {
  const problems: string[] = [];
  const problem = (path: string, rule: string) => problems.push(`${path}: ${rule}`);

  if (workout.name.length < 1 || workout.name.length > MAX_NAME_LENGTH) problem("name", `1 to ${MAX_NAME_LENGTH} characters`);
  if (workout.tags.length > MAX_TAGS) problem("tags", `at most ${MAX_TAGS} tags`);
  workout.tags.forEach((tag, i) => {
    if (!(TAGS as readonly string[]).includes(tag)) problem(`tags[${i}]`, `one of ${TAGS.join(", ")}`);
  });

  const checkStep = (step: InputStep, path: string, nested: boolean) => {
    if (step.type === "repeat") {
      if (nested) return problem(`${path}.type`, "a repeat can't contain another repeat");
      if (!isInteger(step.times, 2)) problem(`${path}.times`, "an integer, at least 2");
      if (step.steps.length === 0) problem(`${path}.steps`, "at least one Step");
      step.steps.forEach((inner, j) => checkStep(inner, `${path}.steps[${j}]`, true));
      return;
    }
    if (!isInteger(step.duration_sec, 1)) problem(`${path}.duration_sec`, "an integer number of seconds, at least 1");
    const percents =
      step.type === "steady" ? { ftp_pct: step.ftp_pct } : step.type === "ramp" ? { from_ftp_pct: step.from_ftp_pct, to_ftp_pct: step.to_ftp_pct } : {};
    for (const [field, value] of Object.entries(percents)) {
      if (!isInteger(value, 0, MAX_FTP_PCT)) problem(`${path}.${field}`, `an integer from 0 to ${MAX_FTP_PCT} (% FTP)`);
    }
    if (step.cadence) {
      const { min_rpm, max_rpm } = step.cadence;
      if (!inRange(min_rpm, 0, MAX_RPM)) problem(`${path}.cadence.min_rpm`, `0 to ${MAX_RPM} rpm`);
      if (!inRange(max_rpm, 0, MAX_RPM)) problem(`${path}.cadence.max_rpm`, `0 to ${MAX_RPM} rpm`);
      if (min_rpm > max_rpm) problem(`${path}.cadence`, "min_rpm can't be above max_rpm");
    }
  };
  workout.steps.forEach((step, i) => checkStep(step, `steps[${i}]`, false));
  if (workout.steps.length === 0) problem("steps", "at least one Step");

  // The total is only meaningful once every duration and repeat count is sound.
  const total = workout.steps.length > 0 && durationsAreSound(workout.steps) ? totalSec(flattenSteps(workout.steps)) : undefined;
  if (total !== undefined && total < MIN_TOTAL_SEC) problem("steps", `at least ${MIN_TOTAL_SEC} s in all (these last ${total} s)`);
  workout.cues.forEach((cue, i) => checkCue(cue, `cues[${i}]`, total, problem));
  return problems;
}

function durationsAreSound(steps: InputStep[], nested = false): boolean {
  return steps.every((step) =>
    step.type === "repeat"
      ? !nested && isInteger(step.times, 2) && step.steps.length > 0 && durationsAreSound(step.steps, true)
      : isInteger(step.duration_sec, 1),
  );
}

function checkCue(cue: Cue, path: string, total: number | undefined, problem: (path: string, rule: string) => void) {
  if (!isInteger(cue.at_sec, 0)) problem(`${path}.at_sec`, "an integer number of seconds from the start, at least 0");
  else if (total !== undefined && cue.at_sec >= total) problem(`${path}.at_sec`, `before the end of the Workout (${total} s)`);
  if (cue.text.trim() === "") problem(`${path}.text`, "not empty");
  if (cue.show_sec !== undefined && !isInteger(cue.show_sec, 1)) problem(`${path}.show_sec`, "an integer number of seconds, at least 1");
}

export function totalSec(steps: Step[]): number {
  return steps.reduce((sum, step) => sum + step.duration_sec, 0);
}

/** Flat Steps to Rouvy's write segments: a free ride is sent at 0 % to 0 %. */
export function toSegments(steps: Step[]): WriteSegment[] {
  return steps.map((step) => {
    const [intervalType, primaryStart, primaryEnd] =
      step.type === "steady"
        ? (["CONSTANT", step.ftp_pct, step.ftp_pct] as const)
        : step.type === "ramp"
          ? (["RAMP", step.from_ftp_pct, step.to_ftp_pct] as const)
          : (["FREE_RIDE", 0, 0] as const);
    return {
      duration: step.duration_sec,
      intervalType,
      primaryStart,
      primaryEnd,
      primaryType: "FTP",
      secondaryMin: step.cadence?.min_rpm ?? null,
      secondaryMax: step.cadence?.max_rpm ?? null,
      secondaryType: step.cadence ? "CADENCE" : null,
    };
  });
}

export function toInstructions(cues: Cue[]): WriteInstruction[] {
  return cues.map((cue) => ({ text: cue.text, showDuration: cue.show_sec ?? DEFAULT_SHOW_SEC, durationFromStart: cue.at_sec }));
}

function isInteger(value: number, min: number, max = Number.MAX_SAFE_INTEGER): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

function inRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}
