import FitParser from "fit-file-parser";
import { describe, expect, it } from "vitest";
import { parseActivityFile } from "../src/activity-file/parse.js";
import { fixtureActivityFile, syntheticActivityFile } from "./server-harness.js";

describe("parseActivityFile", () => {
  it("reads the 1 Hz records, the summary and the lap of a real Activity file", async () => {
    const file = await parseActivityFile(fixtureActivityFile());

    expect(file.records).toHaveLength(1958);
    expect(file.records[0]).toEqual({
      sec: 0,
      timestamp: "2026-05-03T19:54:35.000Z",
      heartRate: 118,
      cadence: 72,
      speed: 1.79,
      power: 258,
      altitude: 66,
      distance: 0,
    });
    expect(file.records.at(-1)).toMatchObject({ sec: 1957, power: 226, distance: 12400.1 });
    expect(file.summary).toEqual({ startTime: "2026-05-03T19:54:35.000Z", totalElapsedTimeSec: 1956.289 });
    expect(file.laps).toEqual([
      { startTime: "2026-05-03T19:54:35.000Z", totalElapsedTimeSec: 1956.289, totalDistanceM: 12400.1 },
    ]);
  });

  it("rejects a file whose CRC doesn't match", async () => {
    const bytes = new Uint8Array(fixtureActivityFile());
    bytes[2000] = (bytes[2000] ?? 0) ^ 0xff;

    await expect(parseActivityFile(bytes.buffer)).rejects.toThrow(/Rouvy changed its API/);
  });

  it("rejects a valid FIT file without a single record", async () => {
    await expect(parseActivityFile(syntheticActivityFile([]))).rejects.toThrow(
      /Rouvy changed its API: the Activity file no longer has records/,
    );
  });
});

describe("the committed Activity file fixture", () => {
  /** Every message, as fit-file-parser reads it, with the CRC checked. */
  async function allMessages() {
    const fit = await new FitParser({ force: false, mode: "list" }).parseAsync(fixtureActivityFile());
    return Object.values(fit).flatMap((value) => (Array.isArray(value) ? value : value && typeof value === "object" ? [value] : []));
  }

  it("has no position anywhere", async () => {
    for (const message of await allMessages()) {
      expect(Object.keys(message).filter((key) => /position|_lat$|_long$/.test(key))).toEqual([]);
    }
  });

  it("has every time shifted to the route detail fixture's day, and no local time", async () => {
    const times = (await allMessages()).flatMap((message) =>
      Object.entries(message).filter(([, value]) => value instanceof Date),
    );

    expect(times.length).toBeGreaterThan(1958);
    // The route detail fixture starts 2026-05-03T19:54:35.130Z; the real Activity was months later.
    for (const [, time] of times) expect((time as Date).toISOString()).toMatch(/^2026-05-03T(19|20):/);
    expect(times.map(([key]) => key)).not.toContain("local_timestamp");
  });

  it("names no sensor of the rider's", async () => {
    const devices = (await allMessages()).filter((message) => "device_index" in message);

    expect(devices.length).toBeGreaterThan(0);
    for (const device of devices) {
      expect(device).not.toHaveProperty("serial_number");
      expect(device.product_name ?? "").toBe("");
    }
  });
});
