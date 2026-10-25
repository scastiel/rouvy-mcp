import { decode } from "turbo-stream";
import { describe, expect, it } from "vitest";
import {
  activityFile,
  AUTH_DATA,
  connect,
  detail,
  DETAIL_ROUTE,
  fakeClock,
  fakeNetwork,
  fixtureActivityFile,
  fixtureDetail,
  memoryCredentials,
  REFRESH,
  refreshes,
  ROUTE_ACTIVITY,
  rouvySessionOpened,
  text,
  turboStream,
} from "./server-harness.js";

type Detail = { activity: Record<string, any>; exportLink: string | null };
type Split = Record<string, number>;

/** The route Activity with its Activity file, optionally changed the way Rouvy might send it. */
async function routeActivity({
  change = () => {},
  file = () => new Response(fixtureActivityFile(), { headers: { "content-type": "application/octet-stream" } }),
}: { change?: (detail: Detail) => void; file?: () => Response } = {}) {
  const { value, done } = await decode(new Blob([fixtureDetail("route")]).stream());
  await done;
  const payload = structuredClone(value) as Record<string, { data: Detail }>;
  change(payload[DETAIL_ROUTE]!.data);
  const clock = fakeClock();
  const credentials = memoryCredentials({ refreshToken: "refresh-for-uid-1", uid: "uid-1" });
  const network = fakeNetwork({
    [REFRESH]: refreshes(clock),
    [AUTH_DATA]: rouvySessionOpened,
    [detail(ROUTE_ACTIVITY)]: () => turboStream(payload),
    [activityFile(ROUTE_ACTIVITY)]: file,
  });
  const client = await connect({ credentials: credentials.provider, fetch: network.fetch, clock });
  const intervals = (args: Record<string, unknown> = {}) =>
    client.callTool({ name: "get_activity_intervals", arguments: { activity_id: ROUTE_ACTIVITY, ...args } });
  return { client, network, clock, intervals };
}

const sum = (splits: Split[], field: string) => splits.reduce((total, split) => total + split[field]!, 0);

describe("get_activity_intervals", () => {
  it("splits the Activity file into 5-min splits whose stats add up to Rouvy's whole-ride numbers", async () => {
    const { intervals, network } = await routeActivity();

    const result = await intervals();

    expect(result.isError).toBeFalsy();
    const body = JSON.parse(text(result));
    expect(body).toMatchObject({
      activity_id: ROUTE_ACTIVITY,
      every_sec: 300,
      duration_sec: 1958,
      rider_settings: { source: "Activity snapshot", ftp_w: 195 },
    });
    expect(body).not.toHaveProperty("notes");
    const splits: Split[] = body.splits;
    expect(splits.map((s) => [s.start_sec, s.end_sec])).toEqual([
      [0, 300],
      [300, 600],
      [600, 900],
      [900, 1200],
      [1200, 1500],
      [1500, 1800],
      [1800, 1958],
    ]);
    for (const split of splits) {
      expect(Object.keys(split).sort()).toEqual(
        [
          "start_sec",
          "end_sec",
          "avg_power_w",
          "np_w",
          "max_power_w",
          "avg_power_pct_ftp",
          "avg_hr_bpm",
          "max_hr_bpm",
          "avg_cadence_rpm",
          "avg_speed_m_s",
          "distance_m",
          "climbing_m",
        ].sort(),
      );
    }
    // Rouvy's whole-ride numbers (get_activity): 12400 m, 231 m climbed, max 474 W, max HR 162, avg 178 W.
    expect(sum(splits, "distance_m")).toBeCloseTo(12400.1, 0);
    expect(sum(splits, "climbing_m")).toBeCloseTo(231, -0.5);
    expect(Math.max(...splits.map((s) => s.max_power_w!))).toBe(474);
    expect(Math.max(...splits.map((s) => s.max_hr_bpm!))).toBe(162);
    const weightedAvgPower = splits.reduce((t, s) => t + s.avg_power_w! * (s.end_sec! - s.start_sec!), 0) / 1958;
    expect(Math.round(weightedAvgPower)).toBe(178);

    // The Activity file is fetched without Rouvy's cookies, with the honest user agent.
    const download = network.requests.find((r) => r.url.host === "activities.virtualtraining.eu");
    expect(download?.headers.get("cookie")).toBeNull();
    expect(download?.headers.get("user-agent")).toMatch(/^rouvy-mcp\//);
  });

  it("over one whole-ride split, lands close to Rouvy's NP, %FTP, HR and cadence", async () => {
    const { intervals } = await routeActivity();

    const body = JSON.parse(text(await intervals({ every_sec: 1958 })));

    expect(body.splits).toHaveLength(1);
    const [ride] = body.splits;
    // Rouvy: NP 197, avg power 91 % of FTP, HR avg 143, cadence avg 93 (get_activity on the same Activity).
    expect(Math.abs(ride.np_w - 197) / 197).toBeLessThan(0.02);
    expect(ride.avg_power_pct_ftp).toBe(91);
    expect(Math.round(ride.avg_hr_bpm)).toBe(143);
    expect(Math.round(ride.avg_cadence_rpm)).toBe(93);
  });

  it.each([9, 0, -300, 12.5])("rejects every_sec %j as an input error, without asking Rouvy", async (everySec) => {
    const { intervals, network } = await routeActivity();

    const result = await intervals({ every_sec: everySec });

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/every_sec/);
    expect(network.requests).toHaveLength(0);
  });

  it("leaves out NP from a split shorter than the 30 s it needs, and says why", async () => {
    const { intervals } = await routeActivity();

    const body = JSON.parse(text(await intervals({ every_sec: 10 })));

    expect(body.splits).toHaveLength(196);
    expect(body.splits[0]).not.toHaveProperty("np_w");
    expect(body.splits[0]).toHaveProperty("avg_power_w");
    expect(body.notes).toContain("NP needs at least 30 s of data: left out of splits shorter than that.");
  });

  it("without a heart-rate strap, leaves out the HR stats and says why", async () => {
    const { intervals } = await routeActivity({
      change: ({ activity }) => {
        activity.total.aggrs.hr = { min: 0, max: 0, avg: 0 };
      },
    });

    const body = JSON.parse(text(await intervals()));

    for (const split of body.splits) {
      expect(split).not.toHaveProperty("avg_hr_bpm");
      expect(split).not.toHaveProperty("max_hr_bpm");
      expect(split).toHaveProperty("np_w");
    }
    expect(body.notes).toEqual(["No heart-rate data in this Activity: heart-rate stats left out."]);
  });

  it("without an FTP in the Activity snapshot, leaves out %FTP and says why, never using another FTP", async () => {
    const { intervals } = await routeActivity({
      change: (detail) => {
        detail.activity.user.FTP = 0;
        // The rider's current settings: never used.
        (detail as Record<string, unknown>).userFtp = 250;
      },
    });

    const body = JSON.parse(text(await intervals()));

    for (const split of body.splits) {
      expect(split).not.toHaveProperty("avg_power_pct_ftp");
      expect(split).toHaveProperty("np_w");
    }
    expect(body.rider_settings).toEqual({ source: "Activity snapshot" });
    expect(body.notes).toEqual(["The Activity snapshot has no FTP: %FTP left out."]);
  });

  it("without power, leaves out every power stat and says why", async () => {
    const { intervals } = await routeActivity({
      change: ({ activity }) => {
        activity.total.aggrs.pwrW = { min: 0, max: 0, avg: 0 };
      },
    });

    const body = JSON.parse(text(await intervals()));

    for (const split of body.splits) {
      for (const field of ["avg_power_w", "np_w", "max_power_w", "avg_power_pct_ftp"]) expect(split).not.toHaveProperty(field);
      expect(split).toHaveProperty("avg_hr_bpm");
    }
    expect(body.notes).toEqual(["No power data in this Activity: power stats and %FTP left out."]);
  });

  it.each([403, 404])("answers 'No Activity file' when the export URL returns %i, while get_activity still works", async (status) => {
    const { intervals, client } = await routeActivity({ file: () => new Response("<Error>secret-ish</Error>", { status }) });

    const result = await intervals();

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("No Activity file");
    expect(text(result)).not.toContain("secret-ish");
    expect(text(result)).not.toContain(ROUTE_ACTIVITY);
    const summary = await client.callTool({ name: "get_activity", arguments: { activity_id: ROUTE_ACTIVITY } });
    expect(summary.isError).toBeFalsy();
  });

  it("answers 'No Activity file' without a request when Rouvy offers none", async () => {
    const { intervals, network } = await routeActivity({
      change: (detail) => {
        detail.exportLink = null;
      },
    });

    const result = await intervals();

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("No Activity file");
    expect(network.requests.some((r) => r.url.host === "activities.virtualtraining.eu")).toBe(false);
  });

  it("reuses the parsed Activity file on a repeat call, even once the detail has expired", async () => {
    const { intervals, network, clock } = await routeActivity();
    const downloads = () => network.requests.filter((r) => r.url.host === "activities.virtualtraining.eu").length;

    const first = await intervals();
    clock.advance(60 * 60_000);
    const second = await intervals({ every_sec: 600 });
    const third = await intervals();

    expect(downloads()).toBe(1);
    expect(JSON.parse(text(second)).splits).toHaveLength(4);
    expect(text(third)).toBe(text(first));
  });
});
