import { describe, expect, it } from "vitest";
import { ROUTE_ACTIVITY, routeActivityServer, syntheticActivityFile, text } from "./server-harness.js";

async function routeActivity(options: Parameters<typeof routeActivityServer>[0] = {}) {
  const server = await routeActivityServer(options);
  const streams = (args: Record<string, unknown> = {}) =>
    server.client.callTool({ name: "get_activity_streams", arguments: { activity_id: ROUTE_ACTIVITY, ...args } });
  const windowStats = async (start_sec: number, end_sec: number) =>
    JSON.parse(
      text(
        await server.client.callTool({
          name: "get_window_stats",
          arguments: { activity_id: ROUTE_ACTIVITY, start_sec, end_sec },
        }),
      ),
    ).stats;
  return { ...server, streams, windowStats };
}

describe("get_activity_streams", () => {
  it("by default, gives power, heart rate and cadence over the whole Activity as 30 s means", async () => {
    const { streams, windowStats } = await routeActivity();

    const result = await streams();

    expect(result.isError).toBeFalsy();
    const body = JSON.parse(text(result));
    expect(body).toMatchObject({ activity_id: ROUTE_ACTIVITY, start_sec: 0, end_sec: 1958, resolution_sec_used: 30 });
    expect(Object.keys(body.streams)).toEqual(["power", "heart_rate", "cadence"]);
    // 1958 s in 30 s buckets: 65 full ones and a last one of 8 s.
    for (const column of Object.values(body.streams)) expect(column).toHaveLength(66);
    for (const [index, start, end] of [
      [0, 0, 30],
      [20, 600, 630],
      [65, 1950, 1958],
    ] as const) {
      const stats = await windowStats(start, end);
      expect(body.streams.power[index]).toBe(stats.avg_power_w);
      expect(body.streams.heart_rate[index]).toBe(stats.avg_hr_bpm);
      expect(body.streams.cadence[index]).toBe(stats.avg_cadence_rpm);
    }
    expect(body).not.toHaveProperty("notes");
  });

  it("serves a request over 500 points per field at the smallest resolution that fits, and says so", async () => {
    const { streams } = await routeActivity();

    const body = JSON.parse(text(await streams({ fields: ["power"], resolution_sec: 1 })));

    // 1958 s: 3 s would give 653 points, 4 s gives 490.
    expect(body.resolution_sec_used).toBe(4);
    expect(body.streams.power).toHaveLength(490);
    expect(body.notes).toEqual(["At most 500 points per field: served at 4 s instead of 1 s."]);
  });

  it("keeps a request of exactly 500 points as asked", async () => {
    const { streams } = await routeActivity();

    const body = JSON.parse(text(await streams({ fields: ["power"], resolution_sec: 2, start_sec: 0, end_sec: 1000 })));

    expect(body.resolution_sec_used).toBe(2);
    expect(body.streams.power).toHaveLength(500);
    expect(body).not.toHaveProperty("notes");
  });

  it("applies the cap to the stretch actually served, after clamping its end to the Activity file", async () => {
    const { streams } = await routeActivity();

    const body = JSON.parse(text(await streams({ fields: ["power"], resolution_sec: 1, start_sec: 900, end_sec: 9000 })));

    // 900–1958 is 1058 s: 2 s would give 529 points, 3 s gives 353.
    expect(body).toMatchObject({ start_sec: 900, end_sec: 1958, resolution_sec_used: 3 });
    expect(body.streams.power).toHaveLength(353);
    expect(body.notes).toEqual([
      "The Activity file ends at 1958 s: the streams end there.",
      "At most 500 points per field: served at 3 s instead of 1 s.",
    ]);
  });

  it("without a heart-rate strap, lists heart rate as missing instead of filling it with zeros", async () => {
    const { streams } = await routeActivity({
      change: ({ activity }) => {
        activity.total.aggrs.hr = { min: 0, max: 0, avg: 0 };
      },
    });

    const body = JSON.parse(text(await streams()));

    expect(Object.keys(body.streams)).toEqual(["power", "cadence"]);
    expect(body.missing_fields).toEqual(["heart_rate"]);
    expect(body.notes).toEqual(["No heart-rate data in this Activity: heart_rate left out."]);
  });

  it("lists a field the Activity file doesn't carry as missing, and gives null for a bucket with no readings", async () => {
    // Heart rate drops out from 60 s; there's no altitude at all.
    const records = Array.from({ length: 120 }, (_, sec) => ({
      power: sec < 30 ? 100 : 200,
      heartRate: sec < 60 ? 120 : undefined,
      distance: sec * 10,
    }));
    const { streams } = await routeActivity({
      change: ({ activity }) => {
        activity.total.aggrs.cadRPM = { min: 0, max: 0, avg: 0 };
        activity.total.aggrs.spdMs = { min: 0, max: 0, avg: 0 };
      },
      file: () => new Response(syntheticActivityFile(records)),
    });

    const body = JSON.parse(
      text(await streams({ fields: ["power", "heart_rate", "altitude", "distance"], resolution_sec: 60 })),
    );

    expect(body.streams).toEqual({ power: [150, 200], heart_rate: [120, null], distance: [295, 895] });
    expect(body.missing_fields).toEqual(["altitude"]);
    expect(body.notes).toEqual([
      "The Activity file has no altitude: altitude left out.",
      "The Activity file has no heart_rate for 1 of 2 buckets: null there.",
    ]);
  });

  it("covers only the asked stretch, with buckets counted from start_sec", async () => {
    const { streams, windowStats } = await routeActivity();

    const body = JSON.parse(text(await streams({ fields: ["power"], resolution_sec: 60, start_sec: 600, end_sec: 900 })));

    expect(body).toMatchObject({ start_sec: 600, end_sec: 900, resolution_sec_used: 60 });
    expect(body.streams.power).toHaveLength(5);
    expect(body.streams.power[1]).toBe((await windowStats(660, 720)).avg_power_w);
  });

  it("ends a stretch that runs past the end of the Activity file at its end, and says so", async () => {
    const { streams } = await routeActivity();

    const body = JSON.parse(text(await streams({ fields: ["power"], start_sec: 1800, end_sec: 5000 })));

    expect(body).toMatchObject({ start_sec: 1800, end_sec: 1958 });
    expect(body.streams.power).toHaveLength(6);
    expect(body.notes).toEqual(["The Activity file ends at 1958 s: the streams end there."]);
  });

  it("answers with an error for a stretch that starts after the Activity file ends", async () => {
    const { streams } = await routeActivity();

    const result = await streams({ start_sec: 1958 });

    expect(result.isError).toBe(true);
    expect(text(result)).toBe("start_sec is past the end of this Activity (its Activity file lasts 1958 s).");
  });

  it.each([
    { start_sec: 600, end_sec: 600 },
    { start_sec: 600, end_sec: 300 },
    { end_sec: 0 },
    { resolution_sec: 0 },
    { resolution_sec: 1.5 },
    { fields: [] },
    { fields: ["watts"] },
  ])("rejects %j as an input error, without asking Rouvy", async (args) => {
    const { streams, network } = await routeActivity();

    const result = await streams(args);

    expect(result.isError).toBe(true);
    expect(network.requests).toHaveLength(0);
  });

  it("answers 'No Activity file' when the export URL returns 403", async () => {
    const { streams } = await routeActivity({ file: () => new Response("<Error/>", { status: 403 }) });

    const result = await streams();

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("No Activity file");
  });
});
