import { describe, expect, it } from "vitest";
import { ROUTE_ACTIVITY, routeActivityServer, syntheticActivityFile, text } from "./server-harness.js";

async function routeActivity(options: Parameters<typeof routeActivityServer>[0] = {}) {
  const server = await routeActivityServer(options);
  const windowStats = (args: Record<string, unknown>) =>
    server.client.callTool({ name: "get_window_stats", arguments: { activity_id: ROUTE_ACTIVITY, ...args } });
  return { ...server, windowStats };
}

const noCadenceOrSpeed = ({ activity }: { activity: Record<string, any> }) => {
  activity.total.aggrs.cadRPM = { min: 0, max: 0, avg: 0 };
  activity.total.aggrs.spdMs = { min: 0, max: 0, avg: 0 };
};

describe("get_window_stats", () => {
  it("over the whole ride, finds Rouvy's own power peaks and lands close to its NP and climbing", async () => {
    const { windowStats } = await routeActivity();

    const result = await windowStats({ start_sec: 0, end_sec: 1958 });

    expect(result.isError).toBeFalsy();
    const body = JSON.parse(text(result));
    expect(body).toMatchObject({
      activity_id: ROUTE_ACTIVITY,
      start_sec: 0,
      end_sec: 1958,
      rider_settings: { source: "Activity snapshot", ftp_w: 195 },
    });
    // Rouvy's PP for this Activity: 462, 399, 298, 200, 181, 179 W; it's shorter than 60 min.
    const peaks = Object.fromEntries(Object.entries(body.best_efforts_w).map(([d, w]) => [d, Math.round(w as number)]));
    expect(peaks).toEqual({ "5s": 462, "30s": 399, "1min": 298, "5min": 200, "20min": 181, "30min": 179 });
    expect(Math.abs(body.stats.np_w - 197) / 197).toBeLessThan(0.02);
    expect(body.stats.avg_power_pct_ftp).toBe(91);
    expect(body.stats.climbing_m).toBeCloseTo(231, -0.5);
    expect(body.halves.first).toMatchObject({ start_sec: 0, end_sec: 979 });
    expect(body.halves.second).toMatchObject({ start_sec: 979, end_sec: 1958 });
    expect(body.halves.first.climbing_m + body.halves.second.climbing_m).toBeCloseTo(body.stats.climbing_m, 1);
    expect(typeof body.decoupling_pct).toBe("number");
    expect(body).not.toHaveProperty("notes");
  });

  it("gives the same stats as the matching split, and only the peaks that fit in the window", async () => {
    const { windowStats, client } = await routeActivity();

    const body = JSON.parse(text(await windowStats({ start_sec: 600, end_sec: 900 })));
    const intervals = JSON.parse(
      text(await client.callTool({ name: "get_activity_intervals", arguments: { activity_id: ROUTE_ACTIVITY } })),
    );

    expect(body.stats).toEqual(intervals.splits[2]);
    expect(Object.keys(body.best_efforts_w)).toEqual(["5s", "30s", "1min", "5min"]);
  });

  it("measures HR:power decoupling as the drop in power per heartbeat from the first half to the second", async () => {
    // Same 200 W throughout; HR drifts from 100 to 110 bpm: 2.0 → 1.818 W/bpm, a 9.09 % drop.
    const records = Array.from({ length: 120 }, (_, sec) => ({ power: 200, heartRate: sec < 60 ? 100 : 110 }));
    const { windowStats } = await routeActivity({
      change: noCadenceOrSpeed,
      file: () => new Response(syntheticActivityFile(records)),
    });

    const body = JSON.parse(text(await windowStats({ start_sec: 0, end_sec: 120 })));

    expect(body.halves.first).toMatchObject({ avg_power_w: 200, avg_hr_bpm: 100 });
    expect(body.halves.second).toMatchObject({ avg_power_w: 200, avg_hr_bpm: 110 });
    expect(body.decoupling_pct).toBe(9.09);
  });

  it("without a heart-rate strap, leaves out the HR stats and decoupling, and says why", async () => {
    const { windowStats } = await routeActivity({
      change: ({ activity }) => {
        activity.total.aggrs.hr = { min: 0, max: 0, avg: 0 };
      },
    });

    const body = JSON.parse(text(await windowStats({ start_sec: 0, end_sec: 1958 })));

    for (const stats of [body.stats, body.halves.first, body.halves.second]) {
      expect(stats).not.toHaveProperty("avg_hr_bpm");
      expect(stats).not.toHaveProperty("max_hr_bpm");
      expect(stats).toHaveProperty("np_w");
    }
    expect(body).not.toHaveProperty("decoupling_pct");
    expect(body.best_efforts_w).toHaveProperty("5min");
    expect(body.notes).toEqual([
      "No heart-rate data in this Activity: heart-rate stats left out.",
      "Decoupling needs power and heart rate in both halves: left out.",
    ]);
  });

  it("without an FTP in the Activity snapshot, leaves out %FTP and says why", async () => {
    const { windowStats } = await routeActivity({
      change: ({ activity }) => {
        activity.user.FTP = 0;
      },
    });

    const body = JSON.parse(text(await windowStats({ start_sec: 0, end_sec: 600 })));

    expect(body.stats).not.toHaveProperty("avg_power_pct_ftp");
    expect(body).toHaveProperty("decoupling_pct");
    expect(body.notes).toEqual(["The Activity snapshot has no FTP: %FTP left out."]);
  });

  it("says why when the halves are too short for NP", async () => {
    const { windowStats } = await routeActivity();

    const body = JSON.parse(text(await windowStats({ start_sec: 0, end_sec: 40 })));

    expect(body.stats).toHaveProperty("np_w");
    expect(body.halves.first).not.toHaveProperty("np_w");
    expect(Object.keys(body.best_efforts_w)).toEqual(["5s", "30s"]);
    expect(body.notes).toEqual(["NP needs at least 30 s of data: left out of both halves."]);
  });

  it("ends a window that runs past the end of the Activity file at its end, and says so", async () => {
    const { windowStats } = await routeActivity();

    const body = JSON.parse(text(await windowStats({ start_sec: 1800, end_sec: 5000 })));

    expect(body).toMatchObject({ start_sec: 1800, end_sec: 1958 });
    expect(body.stats).toMatchObject({ start_sec: 1800, end_sec: 1958 });
    expect(body.notes).toEqual(["The Activity file ends at 1958 s: the window ends there."]);
  });

  it("answers with an error for a window that starts after the Activity file ends", async () => {
    const { windowStats } = await routeActivity();

    const result = await windowStats({ start_sec: 1958, end_sec: 2000 });

    expect(result.isError).toBe(true);
    expect(text(result)).toBe("start_sec is past the end of this Activity (its Activity file lasts 1958 s).");
  });

  it.each([
    [600, 600],
    [600, 300],
  ])("rejects start_sec %i, end_sec %i as an input error, without asking Rouvy", async (start, end) => {
    const { windowStats, network } = await routeActivity();

    const result = await windowStats({ start_sec: start, end_sec: end });

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/end_sec/);
    expect(network.requests).toHaveLength(0);
  });

  it.each([{ start_sec: -1, end_sec: 60 }, { start_sec: 0.5, end_sec: 60 }, { start_sec: 0 }])(
    "rejects %j as an input error",
    async (args) => {
      const { windowStats, network } = await routeActivity();

      const result = await windowStats(args);

      expect(result.isError).toBe(true);
      expect(network.requests).toHaveLength(0);
    },
  );

  it("answers 'No Activity file' when the export URL returns 403", async () => {
    const { windowStats } = await routeActivity({ file: () => new Response("<Error/>", { status: 403 }) });

    const result = await windowStats({ start_sec: 0, end_sec: 600 });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("No Activity file");
  });
});
