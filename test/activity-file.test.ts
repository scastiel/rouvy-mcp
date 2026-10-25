import { describe, expect, it } from "vitest";
import { parseActivityFile } from "../src/activity-file/parse.js";
import { fixtureActivityFile } from "./server-harness.js";

describe("parseActivityFile", () => {
  it("reads the 1 Hz records, the session and the lap of a real Activity file", async () => {
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
    expect(file.session).toEqual({ startTime: "2026-05-03T19:54:35.000Z", totalElapsedTimeSec: 1956.289 });
    expect(file.laps).toEqual([
      { startTime: "2026-05-03T19:54:35.000Z", totalElapsedTimeSec: 1956.289, totalDistanceM: 12400.1 },
    ]);
  });

  it("the committed fixture is redacted: no positions, timestamps shifted to the detail fixture's start", async () => {
    const file = await parseActivityFile(fixtureActivityFile());

    expect(file.records.some((r) => r.positionLat !== undefined || r.positionLong !== undefined)).toBe(false);
    // The route detail fixture starts 2026-05-03T19:54:35.130Z; the real ride was in October.
    expect(file.records.every((r) => r.timestamp.startsWith("2026-05-03"))).toBe(true);
  });

  it("rejects a file whose CRC doesn't match", async () => {
    const bytes = new Uint8Array(fixtureActivityFile());
    bytes[2000] = (bytes[2000] ?? 0) ^ 0xff;

    await expect(parseActivityFile(bytes.buffer)).rejects.toThrow(/Rouvy changed its API/);
  });
});
