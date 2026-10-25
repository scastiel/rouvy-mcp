import { decode } from "turbo-stream";
import { describe, expect, it } from "vitest";
import {
  AUTH_DATA,
  connect,
  detail,
  DETAIL_ROUTE,
  fakeClock,
  fakeNetwork,
  fixtureDetail,
  memoryCredentials,
  REFRESH,
  refreshes,
  ROUTE_ACTIVITY,
  rouvySessionOpened,
  WORKOUT_ACTIVITY,
  text,
  turboStream,
} from "./server-harness.js";

const served = (body: string) => () => new Response(body, { headers: { "content-type": "text/x-script" } });

function loggedInRider(clock = fakeClock(), uid = "uid-1") {
  return { clock, credentials: memoryCredentials({ refreshToken: `refresh-for-${uid}`, uid }) };
}

describe("get_activity", () => {
  it("returns Rouvy's own summary and the Rider settings from the Activity snapshot", async () => {
    const { clock, credentials } = loggedInRider();
    const network = fakeNetwork({
      [REFRESH]: refreshes(clock),
      [AUTH_DATA]: rouvySessionOpened,
      [detail(ROUTE_ACTIVITY)]: served(fixtureDetail("route")),
    });
    const client = await connect({ credentials: credentials.provider, fetch: network.fetch, clock });

    const result = await client.callTool({ name: "get_activity", arguments: { activity_id: ROUTE_ACTIVITY } });

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result))).toEqual({
      id: ROUTE_ACTIVITY,
      title: "Fixture Activity 0",
      type: "ROUTE",
      start: "2026-05-03T19:54:35.130Z",
      elapsed_time_sec: 1956,
      moving_time_sec: 1956,
      distance_m: 12400,
      elevation_m: 231,
      kcal: 333,
      np_w: 197,
      if: 1.01,
      tss: 55,
      power_peaks_w: { "5s": 462, "30s": 399, "1min": 298, "5min": 200, "20min": 181, "30min": 179 },
      power_w: { min: 0, max: 474, avg: 178 },
      heart_rate_bpm: { min: 117, max: 162, avg: 143 },
      cadence_rpm: { min: 0, max: 125, avg: 93 },
      speed_m_s: { min: 1, max: 19, avg: 6.3 },
      avg_power_pct_ftp: 91,
      time_in_power_zones_sec: [
        { zone: 1, sec: 297 },
        { zone: 2, sec: 213 },
        { zone: 3, sec: 272 },
        { zone: 4, sec: 640 },
        { zone: 5, sec: 295 },
        { zone: 6, sec: 154 },
        { zone: 7, sec: 86 },
      ],
      time_in_hr_zones_sec: [
        { zone: 1, sec: 0 },
        { zone: 2, sec: 12 },
        { zone: 3, sec: 708 },
        { zone: 4, sec: 1198 },
        { zone: 5, sec: 39 },
        { zone: 6, sec: 0 },
        { zone: 7, sec: 0 },
      ],
      laps: [],
      segments: [
        {
          name: "Segment 1",
          type: "climb",
          distance_m: 1802.72,
          elevation_m: 137.2,
          avg_grade_pct: 7.61,
          time_sec: 703.5,
          avg_power_w: 191.2,
          avg_speed_m_s: 2.56,
          avg_hr_bpm: 145,
        },
        {
          name: "Segment 2",
          type: "sprint",
          distance_m: 300,
          elevation_m: 1.54,
          avg_grade_pct: 0.51,
          time_sec: 26.73,
          avg_power_w: 397.4,
          avg_speed_m_s: 11.22,
          avg_hr_bpm: 152,
        },
      ],
      rider_settings: {
        source: "Activity snapshot",
        ftp_w: 195,
        weight_kg: 87,
        max_hr_bpm: 190,
        power_zones_w: [
          { zone: 1, from: 0, to: 107 },
          { zone: 2, from: 107, to: 146 },
          { zone: 3, from: 146, to: 176 },
          { zone: 4, from: 176, to: 205 },
          { zone: 5, from: 205, to: 234 },
          { zone: 6, from: 234, to: 292 },
          { zone: 7, from: 292 },
        ],
        hr_zones_bpm: [
          { zone: 1, from: 0, to: 114 },
          { zone: 2, from: 114, to: 124 },
          { zone: 3, from: 124, to: 142 },
          { zone: 4, from: 142, to: 156 },
          { zone: 5, from: 156, to: 169 },
          { zone: 6, from: 169, to: 179 },
          { zone: 7, from: 179 },
        ],
      },
      available_fields: { power: true, heart_rate: true, cadence: true, speed: true, activity_file: true },
      notes: ["No 60min power peak: the Activity is shorter than that."],
    });
    const request = network.requests.find((r) => r.url.host === "riders.rouvy.com");
    expect(request?.headers.get("cookie")).toContain("rouvy_session=c2Vzc2lvbg");
    expect(request?.headers.get("user-agent")).toMatch(/^rouvy-mcp\//);
  });
});

describe("get_activity with missing data", () => {
  type Detail = { activity: Record<string, any>; exportLink: string | null };

  /** The route fixture, changed the way Rouvy might send it. */
  async function routeActivityWhere(change: (detail: Detail) => void) {
    const { value, done } = await decode(new Blob([fixtureDetail("route")]).stream());
    await done;
    const payload = structuredClone(value) as Record<string, { data: Detail }>;
    change(payload[DETAIL_ROUTE]!.data);
    const { clock, credentials } = loggedInRider();
    const network = fakeNetwork({
      [REFRESH]: refreshes(clock),
      [AUTH_DATA]: rouvySessionOpened,
      [detail(ROUTE_ACTIVITY)]: () => turboStream(payload),
    });
    const client = await connect({ credentials: credentials.provider, fetch: network.fetch, clock });
    return client.callTool({ name: "get_activity", arguments: { activity_id: ROUTE_ACTIVITY } });
  }

  it("without a heart-rate strap, leaves out every HR value and says why", async () => {
    const result = await routeActivityWhere(({ activity }) => {
      activity.total.aggrs.hr = { min: 0, max: 0, avg: 0 };
      activity.total.hists.hr = [0, 0, 0, 0, 0, 0, 0];
      for (const pass of activity.segmentsPasses) pass.avgHeartRateBPM = 0;
    });

    const body = JSON.parse(text(result));
    expect(result.isError).toBeFalsy();
    expect(body).not.toHaveProperty("heart_rate_bpm");
    expect(body).not.toHaveProperty("time_in_hr_zones_sec");
    expect(body.segments[0]).not.toHaveProperty("avg_hr_bpm");
    expect(body.available_fields.heart_rate).toBe(false);
    expect(body.rider_settings.max_hr_bpm).toBe(190); // a Rider setting, still reported
    expect(body.notes).toContain("No heart-rate data in this Activity: heart-rate stats and time in HR zones left out.");
    expect(body.np_w).toBe(197);
  });

  it("without an FTP in the snapshot, leaves out IF, TSS, %FTP and power-zone time, and says why", async () => {
    const result = await routeActivityWhere(({ activity }) => {
      activity.user.FTP = 0;
    });

    const body = JSON.parse(text(result));
    for (const field of ["if", "tss", "avg_power_pct_ftp", "time_in_power_zones_sec"]) expect(body).not.toHaveProperty(field);
    expect(body.rider_settings).not.toHaveProperty("ftp_w");
    expect(body.np_w).toBe(197);
    expect(body.power_w).toEqual({ min: 0, max: 474, avg: 178 });
    expect(body.notes).toContain("The Activity snapshot has no FTP: IF, TSS, %FTP and time in power zones left out.");
  });

  it("without power, leaves out every power value and says why", async () => {
    const result = await routeActivityWhere(({ activity }) => {
      activity.total.aggrs.pwrW = { min: 0, max: 0, avg: 0 };
      activity.total.PP = [0, 0, 0, 0, 0, 0, 0];
    });

    const body = JSON.parse(text(result));
    for (const field of ["np_w", "if", "tss", "power_peaks_w", "power_w", "avg_power_pct_ftp", "time_in_power_zones_sec"]) {
      expect(body).not.toHaveProperty(field);
    }
    expect(body.available_fields.power).toBe(false);
    expect(body.notes).toEqual([
      "No power data in this Activity: NP, IF, TSS, power peaks, power stats, %FTP and time in power zones left out.",
    ]);
  });

  it("without power or an FTP, still says the FTP is left out", async () => {
    const result = await routeActivityWhere(({ activity }) => {
      activity.total.aggrs.pwrW = { min: 0, max: 0, avg: 0 };
      activity.user.FTP = 0;
    });

    const body = JSON.parse(text(result));
    expect(body.rider_settings).not.toHaveProperty("ftp_w");
    expect(body.notes).toContain("The Activity snapshot has no FTP; left out.");
  });

  it("leaves out optional numbers Rouvy sends as null or omits, and says so", async () => {
    const result = await routeActivityWhere(({ activity }) => {
      activity.total.kCal = null;
      delete activity.total.NP;
      delete activity.user.weightKg;
    });

    const body = JSON.parse(text(result));
    expect(body).not.toHaveProperty("kcal");
    expect(body).not.toHaveProperty("np_w");
    expect(body.rider_settings).not.toHaveProperty("weight_kg");
    expect(body.notes).toEqual(
      expect.arrayContaining([
        "Rouvy gave no kcal; left out.",
        "Rouvy gave no NP; left out.",
        "The Activity snapshot has no weight_kg; left out.",
      ]),
    );
  });

  it("still works without an Activity file, and says what that rules out", async () => {
    const result = await routeActivityWhere((detail) => {
      detail.exportLink = null;
    });

    const body = JSON.parse(text(result));
    expect(result.isError).toBeFalsy();
    expect(body.available_fields.activity_file).toBe(false);
    expect(body.notes).toContain(
      "No Activity file: intervals, window stats, streams and export aren't available for this Activity.",
    );
  });

  it.each([
    ["the Activity's id", (d: Detail) => delete d.activity.id, "activity.id"],
    ["the start time", (d: Detail) => delete d.activity.startUTC, "activity.startUTC"],
    ["the export link", (d: Detail) => delete (d as Partial<Detail>).exportLink, "exportLink"],
  ])("names the route and the field when %s is gone", async (_, change, field) => {
    const result = await routeActivityWhere(change);

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Rouvy changed its API");
    expect(text(result)).toContain(DETAIL_ROUTE);
    expect(text(result)).toContain(field);
  });
});

describe("get_activity with an id Rouvy doesn't know", () => {
  const UNKNOWN = "000101000000-zzzzzzzz";

  it("says the Activity wasn't found", async () => {
    const { clock, credentials } = loggedInRider();
    // What Rouvy really does: set its cookies and redirect to the same page, then 404.
    const answers = [
      () =>
        new Response(
          `[["SingleFetchRedirect",1],{"_2":3,"_4":5},"redirect","https://riders.rouvy.com/activity/${UNKNOWN}","status",302]`,
          { status: 202, headers: [["set-cookie", "rouvysession_tos=accepted; Path=/"]] },
        ),
      () => new Response("[{\"_1\":2},\"secret-ish error page\"]", { status: 404 }),
    ];
    const network = fakeNetwork({
      [REFRESH]: refreshes(clock),
      [AUTH_DATA]: rouvySessionOpened,
      [detail(UNKNOWN)]: () => answers.shift()!(),
    });
    const client = await connect({ credentials: credentials.provider, fetch: network.fetch, clock });

    const result = await client.callTool({ name: "get_activity", arguments: { activity_id: UNKNOWN } });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Activity not found");
    expect(text(result)).not.toContain("secret-ish");
  });

  it.each(["../resources/activities-pagination", "260624154125", "260624154125-FIXTURE0", ""])(
    "rejects %j as an input error, without asking Rouvy",
    async (activityId) => {
      const { clock, credentials } = loggedInRider();
      const network = fakeNetwork({});
      const client = await connect({ credentials: credentials.provider, fetch: network.fetch, clock });

      const result = await client.callTool({ name: "get_activity", arguments: { activity_id: activityId } });

      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/activity_id/);
      expect(network.requests).toHaveLength(0);
    },
  );
});

describe("get_activity cache", () => {
  /** Each rider has the route Activity; who's asking is told by the Session's uid. */
  function rider(clock = fakeClock()) {
    const network = fakeNetwork({
      [REFRESH]: refreshes(clock),
      [AUTH_DATA]: rouvySessionOpened,
      [detail(ROUTE_ACTIVITY)]: served(fixtureDetail("route")),
    });
    const detailCalls = () => network.requests.filter((r) => r.url.host === "riders.rouvy.com").length;
    return { clock, network, detailCalls };
  }
  const ask = { name: "get_activity", arguments: { activity_id: ROUTE_ACTIVITY } };

  it("serves a second call within 10 min from memory", async () => {
    const { clock, network, detailCalls } = rider();
    const credentials = memoryCredentials({ refreshToken: "refresh-for-uid-1", uid: "uid-1" });
    const client = await connect({ credentials: credentials.provider, fetch: network.fetch, clock });

    const first = await client.callTool(ask);
    clock.advance(9 * 60_000 + 59_000);
    const second = await client.callTool(ask);
    expect(detailCalls()).toBe(1);
    expect(text(second)).toBe(text(first));

    clock.advance(2_000);
    await client.callTool(ask);
    expect(detailCalls()).toBe(2);
  });

  it("never serves another account's cached Activity", async () => {
    const { clock, network, detailCalls } = rider();
    const credentials = memoryCredentials({ refreshToken: "refresh-for-uid-1", uid: "uid-1" });
    const client = await connect({ credentials: credentials.provider, fetch: network.fetch, clock });
    await client.callTool(ask);

    credentials.set({ refreshToken: "refresh-for-uid-2", uid: "uid-2" });
    await client.callTool(ask);

    expect(detailCalls()).toBe(2);
  });
});

describe("get_activity on a workout", () => {
  async function workout() {
    const { clock, credentials } = loggedInRider();
    const network = fakeNetwork({
      [REFRESH]: refreshes(clock),
      [AUTH_DATA]: rouvySessionOpened,
      [detail(WORKOUT_ACTIVITY)]: served(fixtureDetail("workout")),
    });
    const client = await connect({ credentials: credentials.provider, fetch: network.fetch, clock });
    return client.callTool({ name: "get_activity", arguments: { activity_id: WORKOUT_ACTIVITY } });
  }

  it("lists Rouvy's laps", async () => {
    const body = JSON.parse(text(await workout()));

    expect(body.type).toBe("WORKOUT_FTP_TEST");
    expect(body.laps).toHaveLength(23);
    expect(body.laps[0]).toEqual({
      name: "Lap 1",
      start_sec: 0,
      duration_sec: 300.01,
      distance_m: 1042.61,
      power_w: { min: 0, max: 160, avg: 65 },
      heart_rate_bpm: { min: 43, max: 108, avg: 97 },
      cadence_rpm: { min: 0, max: 94, avg: 71 },
      speed_m_s: { min: 0, max: 5.7, avg: 3.5 },
      target_power_w: 50,
    });
    expect(body.segments).toEqual([]);
  });

  it("reports the snapshot's Rider settings, never the rider's current ones", async () => {
    const result = await workout();
    const body = JSON.parse(text(result));

    // The fixture's current settings (userFtp, userData) are all 999.
    expect(text(result)).not.toContain("999");
    expect(body.rider_settings.ftp_w).toBe(173);
    expect(body.rider_settings.power_zones_w[0]).toEqual({ zone: 1, from: 0, to: 95 });
    expect(body.avg_power_pct_ftp).toBe(73); // Rouvy's 126 W avg / snapshot FTP 173
  });

  it("never shows the Activity file's URL", async () => {
    const result = await workout();

    expect(text(result)).not.toContain("virtualtraining");
    expect(JSON.parse(text(result)).available_fields.activity_file).toBe(true);
  });
});
