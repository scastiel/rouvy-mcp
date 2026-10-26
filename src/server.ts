import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { VERSION } from "./constants.js";
import type { CredentialsProvider } from "./credentials/types.js";
import { withUserAgent } from "./http.js";
import { createRouvyClient, type RouvyClient } from "./rouvy/client.js";
import { systemClock, type Clock } from "./rouvy/clock.js";
import { isNotLoggedIn, isTerminalAuthFailure, RouvyError } from "./rouvy/errors.js";
import { createPushback, type CoolDown } from "./rouvy/pushback.js";
import { createRequestQueue } from "./rouvy/request-queue.js";
import { createSessionManager } from "./rouvy/session-manager.js";
import { STREAM_FIELDS } from "./stats/streams.js";
import type { ExportStorage } from "./storage/types.js";
import { getActivity } from "./tools/get-activity.js";
import { InputError } from "./tools/errors.js";
import { EXPORT_FORMATS, exportActivityFile } from "./tools/export-activity-file.js";
import { getActivityIntervals } from "./tools/get-activity-intervals.js";
import { getActivityStreams, MAX_STREAM_POINTS } from "./tools/get-activity-streams.js";
import { getWindowStats } from "./tools/get-window-stats.js";
import { getWorkout } from "./tools/get-workout.js";
import { listActivities } from "./tools/list-activities.js";
import { listWorkouts } from "./tools/list-workouts.js";

/** Rouvy's Activity id shape: the start as YYMMDDhhmmss, then an 8-character suffix. */
const ACTIVITY_ID = /^\d{12}-[a-z0-9]{8}$/;

const activityId = z
  .string()
  .regex(ACTIVITY_ID, "an Activity id as returned by list_activities (YYMMDDhhmmss-xxxxxxxx)")
  .describe("An Activity id as returned by list_activities.");

/** Digits only, so nothing else ever reaches a URL path (spec-m3 §4). */
const workoutId = z
  .string()
  .regex(/^\d{1,12}$/, "a Workout id as returned by list_workouts (digits)")
  .describe("A Workout id as returned by list_workouts.");

export interface RiderOptions {
  credentials: CredentialsProvider;
  fetch?: typeof globalThis.fetch;
  /**
   * An already-polite fetch from `createPoliteFetch`. Riders given the same one share its queue
   * and cool-down. Without one, the rider builds its own from `fetch`.
   */
  politeFetch?: typeof globalThis.fetch;
  clock?: Clock;
}

/**
 * One rider's live Session and caches, in memory. Servers built around the same Rider share them:
 * the hosted server keeps one per uid and builds a server per HTTP request (spec-m2 §7.3).
 */
export interface Rider {
  readonly rouvy: RouvyClient;
}

export type ServerOptions = (RiderOptions | { rider: Rider }) & {
  /** Where export_activity_file writes. Without one, the tool isn't registered. */
  storage?: ExportStorage;
  /**
   * Called when a tool failed because the rider's login is over (spec-m2 §6), before the tool
   * error goes back. The hosted server ends the Grant then; stdio has nothing to do.
   */
  onTerminalAuthFailure?: () => void;
  /**
   * What a tool says when no Session could be opened, instead of stdio's "run the login command".
   * The hosted server tells the rider to reconnect (spec-m2 §7.6).
   */
  notLoggedInMessage?: (terminal: boolean) => string;
  /** Called as each tool call ends, with what an operator may see of it (spec-m2 §9). */
  onToolCall?: (call: ToolCall) => void;
};

/** How a tool call ended: a category, never the message the rider saw. */
export type ToolOutcome = "ok" | "invalid_input" | "signed_out" | "no_session" | "rouvy_error" | "unexpected";

export interface ToolCall {
  tool: string;
  outcome: ToolOutcome;
  durationMs: number;
}

/** One request at a time, backing off when Rouvy pushes back, with the honest user agent (spec §7). */
export function createPoliteFetch(
  fetch: typeof globalThis.fetch,
  clock: Clock = systemClock,
  { onCoolDown }: { onCoolDown?: (coolDown: CoolDown) => void } = {},
): typeof globalThis.fetch {
  return withUserAgent(createRequestQueue(createPushback(fetch, clock, onCoolDown), clock));
}

export function createRider({
  credentials,
  fetch = globalThis.fetch,
  clock = systemClock,
  politeFetch = createPoliteFetch(fetch, clock),
}: RiderOptions): Rider {
  return { rouvy: createRouvyClient(politeFetch, createSessionManager(politeFetch, credentials, clock), clock) };
}

/** The transport-agnostic core: knows nothing about stdio, files or passwords. */
export function createServer(options: ServerOptions): McpServer {
  const { storage, onTerminalAuthFailure, notLoggedInMessage, onToolCall } = options;
  const { rouvy } = "rider" in options ? options.rider : createRider(options);
  const server = new McpServer({ name: "rouvy-mcp", version: VERSION });
  const toolResult = (tool: string, run: () => Promise<unknown>) =>
    runTool(run, onTerminalAuthFailure, notLoggedInMessage, (outcome, durationMs) => onToolCall?.({ tool, outcome, durationMs }));

  server.registerTool(
    "list_activities",
    {
      description:
        "List the rider's Rouvy Activities, newest first, as compact rows (id, title, type, start, moving time, " +
        "distance, elevation, TSS, IF). Use the ids with the other tools.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).default(10).describe("How many Activities to return (1–50)."),
        offset: z.number().int().min(0).default(0).describe("How many of the newest Activities to skip."),
      }),
    },
    (input) => toolResult("list_activities", () => listActivities(rouvy, input)),
  );

  server.registerTool(
    "get_activity",
    {
      description:
        "One Activity's summary, with Rouvy's own numbers (they match the Rouvy app): times, distance, elevation, " +
        "kcal, NP, IF, TSS, power peaks, min/max/avg power, heart rate, cadence and speed, %FTP, time in power and " +
        "HR zones, laps and route segment results. Also the Rider settings used (FTP, weight, max HR, zones) from " +
        "the Activity snapshot, which data exist, and a note for each value left out.",
      inputSchema: z.object({
        activity_id: activityId,
      }),
    },
    (input) => toolResult("get_activity", () => getActivity(rouvy, input)),
  );

  server.registerTool(
    "get_activity_intervals",
    {
      description:
        "Fixed-size splits of one Activity (every 5 min by default), from its per-second Activity file. " +
        "For each split: start/end second, avg, NP and max power, avg power as %FTP, avg/max heart rate, " +
        "avg cadence, avg speed, distance and climbing. %FTP uses the FTP from the Activity snapshot. " +
        "A note says why any stat is left out.",
      inputSchema: z.object({
        activity_id: activityId,
        every_sec: z.number().int().min(10).default(300).describe("Split length in seconds (at least 10)."),
      }),
    },
    (input) => toolResult("get_activity_intervals", () => getActivityIntervals(rouvy, input)),
  );

  server.registerTool(
    "get_window_stats",
    {
      description:
        "Stats for one stretch of an Activity (e.g. a climb from 20:00 to 35:00), from its per-second Activity " +
        "file: the same stats as one split of get_activity_intervals, plus the best efforts (peak powers for " +
        "the durations that fit), the first half vs the second half, and HR:power decoupling between them. " +
        "%FTP uses the FTP from the Activity snapshot. A note says why any stat is left out.",
      inputSchema: z.object({
        activity_id: activityId,
        start_sec: z.number().int().min(0).describe("Window start, in seconds from the start of the Activity."),
        end_sec: z.number().int().min(1).describe("Window end, in seconds from the start (after start_sec)."),
      }),
    },
    (input) => toolResult("get_window_stats", () => getWindowStats(rouvy, input)),
  );

  server.registerTool(
    "get_activity_streams",
    {
      description:
        "Downsampled per-second data of one Activity, from its Activity file, to chart or reason about: one " +
        "array per field, each value the mean of one bucket of resolution_sec_used seconds from start_sec (the " +
        "last bucket may be shorter). Units: power W, heart_rate bpm, cadence rpm, speed m/s, altitude m, " +
        `distance m from the start. At most ${MAX_STREAM_POINTS} points per field: a finer request is served at ` +
        "the smallest resolution that fits. A field the Activity doesn't have is listed in missing_fields; a " +
        "bucket with no data is null.",
      inputSchema: z.object({
        activity_id: activityId,
        fields: z
          .array(z.enum(STREAM_FIELDS))
          .min(1)
          .default(["power", "heart_rate", "cadence"])
          .describe("Which columns to return."),
        resolution_sec: z.number().int().min(1).default(30).describe("Bucket length in seconds (at least 1)."),
        start_sec: z.number().int().min(0).optional().describe("Start, in seconds from the start (default 0)."),
        end_sec: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("End, in seconds from the start (after start_sec; default the end of the Activity)."),
      }),
    },
    (input) => toolResult("get_activity_streams", () => getActivityStreams(rouvy, input)),
  );

  server.registerTool(
    "list_workouts",
    {
      description:
        "List the rider's own Workouts in their Rouvy library (the plans, not the rides), newest first, as " +
        "compact rows (id, name, duration, TSS, difficulty, tags, number of Steps). Use get_workout for the Steps.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).default(10).describe("How many Workouts to return (1–50)."),
        offset: z.number().int().min(0).default(0).describe("How many of the newest Workouts to skip."),
      }),
      annotations: { readOnlyHint: true },
    },
    (input) => toolResult("list_workouts", () => listWorkouts(rouvy, input)),
  );

  server.registerTool(
    "get_workout",
    {
      description:
        "One of the rider's own Workouts: name, description, tags, visibility, duration, TSS, IF, difficulty, " +
        "route, its Steps (steady, ramp or free ride, in % FTP, with an optional cadence range) and Cues (text " +
        "at a time from the start). Also rider_ftp_w, the rider's current FTP in watts, to turn watts into % FTP.",
      inputSchema: z.object({
        workout_id: workoutId,
      }),
      annotations: { readOnlyHint: true },
    },
    (input) => toolResult("get_workout", () => getWorkout(rouvy, input)),
  );

  if (storage) {
    server.registerTool(
      "export_activity_file",
      {
        description:
          "Save one Activity to the rider's export folder: its Activity file as downloaded from Rouvy (fit), or " +
          "its per-second records as CSV (csv). Overwrites an earlier export of the same Activity and returns " +
          "the file's absolute path.",
        inputSchema: z.object({
          activity_id: activityId,
          format: z.enum(EXPORT_FORMATS).default("csv").describe("fit: the Activity file; csv: per-second records."),
        }),
      },
      (input) => toolResult("export_activity_file", () => exportActivityFile(rouvy, storage, input)),
    );
  }

  return server;
}

async function runTool(
  run: () => Promise<unknown>,
  onTerminalAuthFailure: (() => void) | undefined,
  notLoggedInMessage: ((terminal: boolean) => string) | undefined,
  ended: (outcome: ToolOutcome, durationMs: number) => void,
): Promise<CallToolResult> {
  const start = Date.now();
  try {
    const result = JSON.stringify(await run(), null, 2);
    ended("ok", Date.now() - start);
    return { content: [{ type: "text", text: result }] };
  } catch (error) {
    ended(outcomeOf(error), Date.now() - start);
    if (isTerminalAuthFailure(error)) onTerminalAuthFailure?.();
    // Only our own messages reach the client: anything else could carry a token or a response body.
    const message =
      notLoggedInMessage && isNotLoggedIn(error)
        ? notLoggedInMessage(isTerminalAuthFailure(error))
        : error instanceof RouvyError || error instanceof InputError
        ? error.message
        : "Something went wrong talking to Rouvy. Try later.";
    return { isError: true, content: [{ type: "text", text: message }] };
  }
}

function outcomeOf(error: unknown): ToolOutcome {
  if (isNotLoggedIn(error)) return isTerminalAuthFailure(error) ? "signed_out" : "no_session";
  if (error instanceof InputError) return "invalid_input";
  return error instanceof RouvyError ? "rouvy_error" : "unexpected";
}
