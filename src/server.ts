import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { VERSION } from "./constants.js";
import type { CredentialsProvider } from "./credentials/types.js";
import { withUserAgent } from "./http.js";
import { createRouvyClient } from "./rouvy/client.js";
import { systemClock, type Clock } from "./rouvy/clock.js";
import { RouvyError } from "./rouvy/errors.js";
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
import { listActivities } from "./tools/list-activities.js";

/** Rouvy's Activity id shape: the start as YYMMDDhhmmss, then an 8-character suffix. */
const ACTIVITY_ID = /^\d{12}-[a-z0-9]{8}$/;

const activityId = z
  .string()
  .regex(ACTIVITY_ID, "an Activity id as returned by list_activities (YYMMDDhhmmss-xxxxxxxx)")
  .describe("An Activity id as returned by list_activities.");

export interface ServerOptions {
  credentials: CredentialsProvider;
  fetch?: typeof globalThis.fetch;
  clock?: Clock;
  /** Where export_activity_file writes. Without one, the tool isn't registered. */
  storage?: ExportStorage;
}

/** The transport-agnostic core: knows nothing about stdio, files or passwords. */
export function createServer({
  credentials,
  fetch = globalThis.fetch,
  clock = systemClock,
  storage,
}: ServerOptions): McpServer {
  const politeFetch = withUserAgent(createRequestQueue(fetch, clock));
  const rouvy = createRouvyClient(politeFetch, createSessionManager(politeFetch, credentials, clock), clock);
  const server = new McpServer({ name: "rouvy-mcp", version: VERSION });

  server.registerTool(
    "list_activities",
    {
      description:
        "List the rider's Rouvy Activities, newest first, as compact rows (id, title, type, start, moving time, " +
        "distance, elevation, TSS, IF). Use the ids with the other tools.",
      inputSchema: {
        limit: z.number().int().min(1).max(50).default(10).describe("How many Activities to return (1–50)."),
        offset: z.number().int().min(0).default(0).describe("How many of the newest Activities to skip."),
      },
    },
    (input) => toolResult(() => listActivities(rouvy, input)),
  );

  server.registerTool(
    "get_activity",
    {
      description:
        "One Activity's summary, with Rouvy's own numbers (they match the Rouvy app): times, distance, elevation, " +
        "kcal, NP, IF, TSS, power peaks, min/max/avg power, heart rate, cadence and speed, %FTP, time in power and " +
        "HR zones, laps and route segment results. Also the Rider settings used (FTP, weight, max HR, zones) from " +
        "the Activity snapshot, which data exist, and a note for each value left out.",
      inputSchema: {
        activity_id: activityId,
      },
    },
    (input) => toolResult(() => getActivity(rouvy, input)),
  );

  server.registerTool(
    "get_activity_intervals",
    {
      description:
        "Fixed-size splits of one Activity (every 5 min by default), from its per-second Activity file. " +
        "For each split: start/end second, avg, NP and max power, avg power as %FTP, avg/max heart rate, " +
        "avg cadence, avg speed, distance and climbing. %FTP uses the FTP from the Activity snapshot. " +
        "A note says why any stat is left out.",
      inputSchema: {
        activity_id: activityId,
        every_sec: z.number().int().min(10).default(300).describe("Split length in seconds (at least 10)."),
      },
    },
    (input) => toolResult(() => getActivityIntervals(rouvy, input)),
  );

  server.registerTool(
    "get_window_stats",
    {
      description:
        "Stats for one stretch of an Activity (e.g. a climb from 20:00 to 35:00), from its per-second Activity " +
        "file: the same stats as one split of get_activity_intervals, plus the best efforts (peak powers for " +
        "the durations that fit), the first half vs the second half, and HR:power decoupling between them. " +
        "%FTP uses the FTP from the Activity snapshot. A note says why any stat is left out.",
      inputSchema: {
        activity_id: activityId,
        start_sec: z.number().int().min(0).describe("Window start, in seconds from the start of the Activity."),
        end_sec: z.number().int().min(1).describe("Window end, in seconds from the start (after start_sec)."),
      },
    },
    (input) => toolResult(() => getWindowStats(rouvy, input)),
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
      inputSchema: {
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
      },
    },
    (input) => toolResult(() => getActivityStreams(rouvy, input)),
  );

  if (storage) {
    server.registerTool(
      "export_activity_file",
      {
        description:
          "Save one Activity to the rider's export folder: its Activity file as downloaded from Rouvy (fit), or " +
          "its per-second records as CSV (csv). Overwrites an earlier export of the same Activity and returns " +
          "the file's absolute path.",
        inputSchema: {
          activity_id: activityId,
          format: z.enum(EXPORT_FORMATS).default("csv").describe("fit: the Activity file; csv: per-second records."),
        },
      },
      (input) => toolResult(() => exportActivityFile(rouvy, storage, input)),
    );
  }

  return server;
}

async function toolResult(run: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await run(), null, 2) }] };
  } catch (error) {
    // Only our own messages reach the client: anything else could carry a token or a response body.
    const message =
      error instanceof RouvyError || error instanceof InputError
        ? error.message
        : "Something went wrong talking to Rouvy. Try later.";
    return { isError: true, content: [{ type: "text", text: message }] };
  }
}
