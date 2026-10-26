import { describe, expect, it } from "vitest";
import type { ToolCall } from "../src/server.js";
import type { RecordedRequest } from "./fakes.js";
import {
  AUTH_DATA,
  connect,
  fakeClock,
  fakeNetwork,
  loggedOut,
  memoryCredentials,
  REFRESH,
  refreshes,
  rouvySessionOpened,
  text,
} from "./server-harness.js";
import { DEFAULT_ROUTE, fakeWorkoutLibrary, fixtureRejectedPage } from "./workout-library.js";

const NEW_ID = "100777";

/** A logged-in rider with a fake Rouvy Workout library; `intercept` answers a request first. */
async function rider(intercept?: (request: RecordedRequest) => Response | undefined) {
  const clock = fakeClock();
  const library = await fakeWorkoutLibrary({ intercept });
  const network = fakeNetwork(library.routes({ [REFRESH]: refreshes(clock), [AUTH_DATA]: rouvySessionOpened }));
  const calls: ToolCall[] = [];
  const client = await connect({
    credentials: memoryCredentials({ refreshToken: "refresh-for-uid-1", uid: "uid-1" }).provider,
    fetch: network.fetch,
    clock,
    onToolCall: (call) => calls.push(call),
  });
  const rouvy = () => network.requests.filter((r) => r.url.host === "riders.rouvy.com").map((r) => `${r.method} ${r.url.pathname}`);
  const posts = () => network.requests.filter((r) => r.method === "POST" && r.url.host === "riders.rouvy.com");
  return { client, network, library, calls, rouvy, posts };
}

const isPost = (path: string) => (request: RecordedRequest) => request.method === "POST" && request.url.pathname === path;

const INTERVALS = {
  name: "4×4 VO2",
  description: "Four hard ones",
  tags: ["vo2-max", "warm-up"],
  steps: [
    { type: "ramp", duration_sec: 600, from_ftp_pct: 45, to_ftp_pct: 75 },
    {
      type: "repeat",
      times: 4,
      steps: [
        { type: "steady", duration_sec: 240, ftp_pct: 115, cadence: { min_rpm: 95, max_rpm: 105 } },
        { type: "free_ride", duration_sec: 180 },
      ],
    },
    { type: "steady", duration_sec: 300, ftp_pct: 50 },
  ],
  cues: [
    { at_sec: 600, text: "First one: settle into it" },
    { at_sec: 1600, text: "Last one!", show_sec: 10 },
  ],
};

describe("create_workout", () => {
  it("creates a private Workout from steady, ramp, free-ride and repeat Steps, and returns it read back", async () => {
    const { client, rouvy, posts } = await rider();

    const result = await client.callTool({ name: "create_workout", arguments: INTERVALS });

    expect(result.isError).toBeFalsy();
    const saved = JSON.parse(text(result));
    expect(saved).toMatchObject({
      id: NEW_ID,
      name: "4×4 VO2",
      description: "Four hard ones",
      tags: ["vo2-max", "warm-up"],
      visibility: "private",
      duration_sec: 600 + 4 * 420 + 300,
      route: { id: DEFAULT_ROUTE },
      rider_ftp_w: 250,
      cues: [
        { at_sec: 600, text: "First one: settle into it", show_sec: 15 },
        { at_sec: 1600, text: "Last one!", show_sec: 10 },
      ],
    });
    // Flat, as Rouvy stores them.
    expect(saved.steps).toHaveLength(10);
    expect(saved.steps[1]).toEqual({ type: "steady", duration_sec: 240, ftp_pct: 115, cadence: { min_rpm: 95, max_rpm: 105 } });
    expect(saved.steps[2]).toEqual({ type: "free_ride", duration_sec: 180 });
    // GET first, one POST, then a fresh list and the Workout itself.
    expect(rouvy()).toEqual([
      "GET /workouts/create.data",
      "GET /workouts/collections/created.data",
      "POST /workouts/create",
      "GET /workouts/collections/created.data",
      `GET /workouts/${NEW_ID}.data`,
    ]);
    const [post] = posts();
    expect(post!.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(post!.headers.get("cookie")).toContain("rouvy_session=");
    const form = new URLSearchParams(post!.body);
    expect([...form.keys()]).toEqual(["name", "description", "tags", "access", "recommendedRouteId", "segments", "instructions"]);
    expect(form.get("tags")).toBe("vo2-max,warm-up");
    expect(form.get("access")).toBe("PRIVATE");
    expect(form.get("recommendedRouteId")).toBe(DEFAULT_ROUTE);
  });

  it("rides on the route given, instead of the creator's default", async () => {
    const { client, posts } = await rider();

    const result = await client.callTool({ name: "create_workout", arguments: { ...INTERVALS, route_id: "300003" } });

    expect(JSON.parse(text(result)).route.id).toBe("300003");
    expect(new URLSearchParams(posts()[0]!.body).get("recommendedRouteId")).toBe("300003");
  });

  it("makes a public Workout only when asked", async () => {
    const { client, posts } = await rider();

    await client.callTool({ name: "create_workout", arguments: { ...INTERVALS, visibility: "public" } });

    expect(new URLSearchParams(posts()[0]!.body).get("access")).toBe("PUBLIC");
  });

  it("drops the cached list, so list_workouts shows the new Workout", async () => {
    const { client } = await rider();
    await client.callTool({ name: "list_workouts", arguments: {} });

    await client.callTool({ name: "create_workout", arguments: INTERVALS });
    const list = JSON.parse(text(await client.callTool({ name: "list_workouts", arguments: {} })));

    expect(list.workouts[0].id).toBe(NEW_ID);
  });

  describe("never sends the POST twice", () => {
    it.each([
      ["a 5xx", () => new Response("Bad Gateway", { status: 502 })],
      [
        "a network error",
        () => {
          throw new TypeError("fetch failed");
        },
      ],
    ])("%s on the POST is 'outcome unknown'", async (_, failure) => {
      const { client, posts, calls, rouvy } = await rider((r) => (isPost("/workouts/create")(r) ? failure() : undefined));

      const result = await client.callTool({ name: "create_workout", arguments: INTERVALS });

      expect(result.isError).toBe(true);
      expect(text(result)).toBe("Rouvy may or may not have saved this. Call list_workouts before trying again.");
      expect(posts()).toHaveLength(1);
      expect(calls.at(-1)).toMatchObject({ tool: "create_workout", outcome: "outcome_unknown" });
      // The list is dropped: the next list_workouts asks Rouvy again.
      const before = rouvy().length;
      await client.callTool({ name: "list_workouts", arguments: {} });
      expect(rouvy()).toHaveLength(before + 1);
    });
  });

  it("reports Rouvy's own message when it rejects the form", async () => {
    const { client, calls, posts } = await rider((r) => (isPost("/workouts/create")(r) ? fixtureRejectedPage() : undefined));

    const result = await client.callTool({ name: "create_workout", arguments: INTERVALS });

    expect(text(result)).toBe("Rouvy rejected the write: name: String must contain at most 200 character(s)");
    expect(posts()).toHaveLength(1);
    expect(calls.at(-1)).toMatchObject({ outcome: "write_rejected" });
  });

  it("treats a redirect anywhere but the new Workout as a rejection", async () => {
    const { client } = await rider((r) =>
      isPost("/workouts/create")(r) ? new Response(null, { status: 302, headers: { location: "/workouts" } }) : undefined,
    );

    const result = await client.callTool({ name: "create_workout", arguments: INTERVALS });

    expect(text(result)).toBe("Rouvy didn't accept the Workout. Nothing was saved.");
  });

  it("makes no request at all for an invalid Workout, and lists every problem", async () => {
    const { client, network, calls } = await rider();

    const result = await client.callTool({
      name: "create_workout",
      arguments: {
        name: "Too much",
        steps: [{ type: "steady", duration_sec: 20, ftp_pct: 350 }],
        cues: [{ at_sec: 40, text: "Never shown" }],
      },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toBe(
      "Invalid Workout:\n" +
        "- steps[0].ftp_pct: an integer from 0 to 300 (% FTP)\n" +
        "- steps: at least 30 s in all (these last 20 s)\n" +
        "- cues[0].at_sec: before the end of the Workout (20 s)",
    );
    expect(network.requests).toHaveLength(0);
    expect(calls.at(-1)).toMatchObject({ outcome: "invalid_input" });
  });

  it("refuses a repeat inside a repeat without a request", async () => {
    const { client, network } = await rider();

    const result = await client.callTool({
      name: "create_workout",
      arguments: {
        name: "Nested",
        steps: [{ type: "repeat", times: 2, steps: [{ type: "repeat", times: 2, steps: [{ type: "steady", duration_sec: 60, ftp_pct: 90 }] }] }],
      },
    });

    expect(result.isError).toBe(true);
    expect(network.requests).toHaveLength(0);
  });

  it("sends nothing when the first GET finds the rider logged out", async () => {
    const { client, posts } = await rider((r) => (r.method === "GET" && r.url.pathname === "/workouts/create.data" ? loggedOut() : undefined));

    const result = await client.callTool({ name: "create_workout", arguments: INTERVALS });

    expect(result.isError).toBe(true);
    expect(posts()).toHaveLength(0);
  });

  it("isn't read-only, nor destructive", async () => {
    const { client } = await rider();

    const { tools } = await client.listTools();

    expect(tools.find((t) => t.name === "create_workout")?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
  });
});
