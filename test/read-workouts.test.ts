import { describe, expect, it } from "vitest";
import {
  AUTH_DATA,
  connect,
  fakeClock,
  fakeNetwork,
  FIXTURE_WORKOUT,
  memoryCredentials,
  REFRESH,
  refreshes,
  rouvySessionOpened,
  text,
  WORKOUT_LIST,
  WORKOUT_LIST_ROUTE,
  workoutDetail,
  workoutFixtures,
  workoutList,
} from "./server-harness.js";

type Fixtures = Awaited<ReturnType<typeof workoutFixtures>>;

/** A logged-in rider (uid-1) whose `created` collection and Workout details are the given fixtures. */
async function workoutRider(
  change: (fixtures: Fixtures) => void = () => {},
  extraRoutes: Parameters<typeof fakeNetwork>[0] = {},
) {
  const clock = fakeClock();
  const credentials = memoryCredentials({ refreshToken: "refresh-for-uid-1", uid: "uid-1" });
  const fixtures = await workoutFixtures("uid-1");
  change(fixtures);
  const network = fakeNetwork({
    [REFRESH]: refreshes(clock),
    [AUTH_DATA]: rouvySessionOpened,
    [WORKOUT_LIST]: fixtures.listResponse,
    [workoutDetail(FIXTURE_WORKOUT)]: fixtures.detailResponse,
    ...extraRoutes,
  });
  const client = await connect({ credentials: credentials.provider, fetch: network.fetch, clock });
  const rouvyRequests = () => network.requests.filter((r) => r.url.host === "riders.rouvy.com");
  return { client, network, clock, credentials, fixtures, rouvyRequests };
}

const call = (client: Awaited<ReturnType<typeof workoutRider>>["client"], name: string, args: Record<string, unknown>) =>
  client.callTool({ name, arguments: args });

describe("list_workouts", () => {
  it("returns the rider's own Workouts as compact rows, without Steps", async () => {
    const { client, rouvyRequests } = await workoutRider();

    const result = await call(client, "list_workouts", {});

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result))).toEqual({
      workouts: [
        {
          id: FIXTURE_WORKOUT,
          name: "Fixture Workout 1",
          duration_sec: 5400,
          tss: 64,
          difficulty: "medium",
          tags: [],
          step_count: 7,
        },
      ],
      has_more: false,
    });
    const [listRequest] = rouvyRequests();
    expect(listRequest?.method).toBe("GET");
    expect(listRequest?.url.searchParams.get("_routes")).toBe(WORKOUT_LIST_ROUTE);
    expect(listRequest?.headers.get("cookie")).toContain("rouvy_session=");
  });

  it("keeps Rouvy's newest-first order and pages with limit, offset and has_more", async () => {
    const ids = Array.from({ length: 12 }, (_, i) => String(500 + i));
    const { client } = await workoutRider((f) => Object.assign(f.list, workoutList(f.list, ids)));

    const first = JSON.parse(text(await call(client, "list_workouts", { limit: 5 })));
    const last = JSON.parse(text(await call(client, "list_workouts", { limit: 5, offset: 10 })));

    expect(first.workouts.map((w: { id: string }) => w.id)).toEqual(ids.slice(0, 5));
    expect(first.has_more).toBe(true);
    expect(last.workouts.map((w: { id: string }) => w.id)).toEqual(ids.slice(10));
    expect(last.has_more).toBe(false);
  });

  it("says so when Rouvy lists fewer Workouts than it counts", async () => {
    const { client } = await workoutRider((f) => (f.list.collection.itemsCount = 30));

    const body = JSON.parse(text(await call(client, "list_workouts", {})));

    expect(body.notes).toEqual([expect.stringMatching(/1 of the 30 Workouts/)]);
  });

  it("rejects a limit above 50 without a request", async () => {
    const { client, network } = await workoutRider();

    const result = await call(client, "list_workouts", { limit: 51 });

    expect(result.isError).toBe(true);
    expect(network.requests).toHaveLength(0);
  });

  it("costs no request a second time within 60 s, and refetches after", async () => {
    const { client, clock, rouvyRequests } = await workoutRider();

    await call(client, "list_workouts", {});
    clock.advance(59_000);
    await call(client, "list_workouts", {});
    expect(rouvyRequests()).toHaveLength(1);

    clock.advance(2_000);
    await call(client, "list_workouts", {});
    expect(rouvyRequests()).toHaveLength(2);
  });

  it("never serves one rider's cached list to another", async () => {
    const { client, credentials, rouvyRequests } = await workoutRider();

    await call(client, "list_workouts", {});
    credentials.set({ refreshToken: "refresh-for-uid-2", uid: "uid-2" });
    await call(client, "list_workouts", {});

    expect(rouvyRequests()).toHaveLength(2);
  });
});

describe("get_workout", () => {
  it("returns an owned Workout with flat Steps, route, tags, visibility and the rider's FTP", async () => {
    const { client, rouvyRequests } = await workoutRider();

    const result = await call(client, "get_workout", { workout_id: FIXTURE_WORKOUT });

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result))).toEqual({
      id: FIXTURE_WORKOUT,
      name: "Fixture Workout 1",
      description: "Fixture description",
      tags: [],
      visibility: "private",
      duration_sec: 5400,
      tss: 64,
      if: 0.65,
      difficulty: "medium",
      route: { id: "200001", name: "Fixture route" },
      rider_ftp_w: 250,
      steps: [
        { type: "ramp", duration_sec: 600, from_ftp_pct: 45, to_ftp_pct: 62, cadence: { min_rpm: 78, max_rpm: 98 } },
        { type: "steady", duration_sec: 1200, ftp_pct: 65, cadence: { min_rpm: 80, max_rpm: 100 } },
        { type: "steady", duration_sec: 300, ftp_pct: 65, cadence: { min_rpm: 90, max_rpm: 110 } },
        { type: "steady", duration_sec: 1200, ftp_pct: 68, cadence: { min_rpm: 80, max_rpm: 100 } },
        { type: "steady", duration_sec: 300, ftp_pct: 65, cadence: { min_rpm: 90, max_rpm: 110 } },
        { type: "steady", duration_sec: 1200, ftp_pct: 70, cadence: { min_rpm: 80, max_rpm: 100 } },
        { type: "ramp", duration_sec: 600, from_ftp_pct: 60, to_ftp_pct: 45, cadence: { min_rpm: 78, max_rpm: 98 } },
      ],
      cues: [],
    });
    // The ownership check reads the list first, then the Workout itself.
    expect(rouvyRequests().map((r) => r.url.pathname)).toEqual([
      "/workouts/collections/created.data",
      `/workouts/${FIXTURE_WORKOUT}.data`,
    ]);
    expect(rouvyRequests()[1]?.url.searchParams.get("_routes")).toBe("routes/_main.workouts.$id");
  });

  it("maps every segment kind and Rouvy's instructions to Steps and Cues", async () => {
    const { client } = await workoutRider(({ detail }) => {
      const segment = (intervalType: string, valueStart: number, valueEnd: number, cadence?: [number, number]) => ({
        duration: 60,
        intervalType,
        type: "FTP",
        valueStart,
        valueEnd,
        secondaryType: cadence ? "CADENCE" : null,
        secondaryMin: cadence?.[0] ?? null,
        secondaryMax: cadence?.[1] ?? null,
      });
      detail.workout.segments = [
        segment("CONSTANT", 90, 90),
        segment("RAMP", 50, 100, [85, 95]),
        segment("FREE_RIDE", 0, 0),
        segment("FREE_RIDE", 0, 0, [70, 80]),
      ];
      detail.workout.instructions = [
        { text: "Settle in", showDuration: 15, durationFromStart: 0 },
        { text: "Spin up", showDuration: 10, durationFromStart: 125 },
      ];
      detail.workout.trainingEffects = ["endurance", "cadence"];
      detail.workout.access = "PUBLIC";
    });

    const body = JSON.parse(text(await call(client, "get_workout", { workout_id: FIXTURE_WORKOUT })));

    expect(body.steps).toEqual([
      { type: "steady", duration_sec: 60, ftp_pct: 90 },
      { type: "ramp", duration_sec: 60, from_ftp_pct: 50, to_ftp_pct: 100, cadence: { min_rpm: 85, max_rpm: 95 } },
      { type: "free_ride", duration_sec: 60 },
      { type: "free_ride", duration_sec: 60, cadence: { min_rpm: 70, max_rpm: 80 } },
    ]);
    expect(body.cues).toEqual([
      { at_sec: 0, text: "Settle in", show_sec: 15 },
      { at_sec: 125, text: "Spin up", show_sec: 10 },
    ]);
    expect(body.tags).toEqual(["endurance", "cadence"]);
    expect(body.visibility).toBe("public");
  });

  describe("only ever returns the rider's own Workouts", () => {
    const NOT_FOUND = /No Workout with this id in your library/;

    it("a catalogue Workout (not in `created`, someone else's) is not found, without reading it", async () => {
      const { client, rouvyRequests } = await workoutRider(({ detail }) => (detail.workout.createdBy.firebaseUid = "coach"), {
        [workoutDetail("2684186")]: () => new Response("unexpected", { status: 500 }),
      });

      const result = await call(client, "get_workout", { workout_id: "2684186" });

      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(NOT_FOUND);
      expect(rouvyRequests().map((r) => r.url.pathname)).toEqual(["/workouts/collections/created.data"]);
    });

    it("a listed Workout created by someone else is not found, even though Rouvy says canEdit", async () => {
      const { client } = await workoutRider(({ detail }) => {
        detail.workout.createdBy.firebaseUid = "someone-else";
        detail.canEdit = true;
      });

      const result = await call(client, "get_workout", { workout_id: FIXTURE_WORKOUT });

      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(NOT_FOUND);
      expect(text(result)).not.toContain("someone-else");
    });

    it("a deleted Workout Rouvy still serves by id is not found", async () => {
      const { client } = await workoutRider(({ list }) => (list.collection.workouts = []));

      const result = await call(client, "get_workout", { workout_id: FIXTURE_WORKOUT });

      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(NOT_FOUND);
    });

    it("a listed Workout Rouvy answers 404 for is not found", async () => {
      const { client } = await workoutRider(() => {}, {
        [workoutDetail(FIXTURE_WORKOUT)]: () => new Response("not found", { status: 404 }),
      });

      const result = await call(client, "get_workout", { workout_id: FIXTURE_WORKOUT });

      expect(text(result)).toMatch(NOT_FOUND);
    });
  });

  it("refuses an id that isn't digits, before any request", async () => {
    const { client, network } = await workoutRider();

    for (const workout_id of ["abc", "../activity/1", "1".repeat(13), ""]) {
      const result = await call(client, "get_workout", { workout_id });
      expect(result.isError).toBe(true);
    }
    expect(network.requests).toHaveLength(0);
  });

  it("reads the Workout fresh every time", async () => {
    const { client, rouvyRequests } = await workoutRider();

    await call(client, "get_workout", { workout_id: FIXTURE_WORKOUT });
    await call(client, "get_workout", { workout_id: FIXTURE_WORKOUT });

    // The list is cached; the Workout itself never is.
    expect(rouvyRequests().map((r) => r.url.pathname)).toEqual([
      "/workouts/collections/created.data",
      `/workouts/${FIXTURE_WORKOUT}.data`,
      `/workouts/${FIXTURE_WORKOUT}.data`,
    ]);
  });

  it("says plainly when a Workout has targets other than % FTP", async () => {
    const { client } = await workoutRider(({ detail }) => (detail.workout.segments[0].type = "POWER"));

    const result = await call(client, "get_workout", { workout_id: FIXTURE_WORKOUT });

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/only % FTP/);
  });

  it("names the field when Rouvy's payload drifts", async () => {
    const { client } = await workoutRider(({ detail }) => delete detail.workout.createdBy);

    const result = await call(client, "get_workout", { workout_id: FIXTURE_WORKOUT });

    expect(text(result)).toContain("Rouvy changed its API: routes/_main.workouts.$id no longer has workout.createdBy");
  });
});

it("list_workouts and get_workout are read-only", async () => {
  const { client } = await workoutRider();

  const { tools } = await client.listTools();

  for (const name of ["list_workouts", "get_workout"]) {
    expect(tools.find((t) => t.name === name)?.annotations?.readOnlyHint).toBe(true);
  }
});
