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
import { getActivity } from "./tools/get-activity.js";
import { getActivityIntervals } from "./tools/get-activity-intervals.js";
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
}

/** The transport-agnostic core: knows nothing about stdio, files or passwords. */
export function createServer({ credentials, fetch = globalThis.fetch, clock = systemClock }: ServerOptions): McpServer {
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

  return server;
}

async function toolResult(run: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await run(), null, 2) }] };
  } catch (error) {
    // Only our own messages reach the client: anything else could carry a token or a response body.
    const message = error instanceof RouvyError ? error.message : "Something went wrong talking to Rouvy. Try later.";
    return { isError: true, content: [{ type: "text", text: message }] };
  }
}
