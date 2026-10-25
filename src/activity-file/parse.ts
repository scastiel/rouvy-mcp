import FitParser from "fit-file-parser";
import { apiChanged } from "../rouvy/errors.js";
import { dropEmpty } from "../tools/common.js";

/** One second of an Activity file. A channel the rider didn't record is left out, never 0. */
export interface ActivityRecord {
  /** Seconds from the first record. */
  sec: number;
  /** ISO 8601. */
  timestamp: string;
  heartRate?: number;
  cadence?: number;
  /** m/s */
  speed?: number;
  /** W */
  power?: number;
  /** m */
  altitude?: number;
  /** m from the start */
  distance?: number;
  positionLat?: number;
  positionLong?: number;
}

export interface ActivityFile {
  records: ActivityRecord[];
  /** FIT's `session` message: the whole Activity's totals (not a Session). */
  summary?: { startTime?: string; totalElapsedTimeSec?: number };
  laps: { startTime?: string; totalElapsedTimeSec?: number; totalDistanceM?: number }[];
}

export const ACTIVITY_FILE = "the Activity file";

/**
 * Reads Rouvy's Activity file (FIT) into our own types, keeping only the fields we use.
 * The CRC is checked: a file that doesn't add up is not one we can trust.
 */
export async function parseActivityFile(bytes: ArrayBuffer): Promise<ActivityFile> {
  // `force` defaults to true, which skips the CRC check.
  const parser = new FitParser({ force: false, mode: "list", speedUnit: "m/s", lengthUnit: "m" });
  let fit;
  try {
    fit = await parser.parseAsync(bytes);
  } catch {
    throw apiChanged(ACTIVITY_FILE, "a valid FIT file (parsing failed)");
  }

  const timed = (fit.records ?? []).filter((record) => record.timestamp != null);
  if (timed.length === 0) throw apiChanged(ACTIVITY_FILE, "records");
  const firstMs = toMs(timed[0]!.timestamp!);
  const records = timed.map((record): ActivityRecord => {
    const ms = toMs(record.timestamp!);
    return dropEmpty({
      sec: Math.round((ms - firstMs) / 1000),
      timestamp: new Date(ms).toISOString(),
      heartRate: record.heart_rate,
      cadence: record.cadence,
      speed: record.speed,
      power: record.power,
      altitude: record.altitude,
      distance: record.distance,
      positionLat: record.position_lat,
      positionLong: record.position_long,
    });
  });
  const summary = fit.sessions?.[0];
  return {
    records,
    ...(summary && {
      summary: dropEmpty({
        startTime: isoOrUndefined(summary.start_time),
        totalElapsedTimeSec: summary.total_elapsed_time,
      }),
    }),
    laps: (fit.laps ?? []).map((lap) =>
      dropEmpty({
        startTime: isoOrUndefined(lap.start_time),
        totalElapsedTimeSec: lap.total_elapsed_time,
        totalDistanceM: lap.total_distance,
      }),
    ),
  };
}

function toMs(value: Date | string | number): number {
  return new Date(value).getTime();
}

function isoOrUndefined(value: Date | string | number | undefined): string | undefined {
  return value == null ? undefined : new Date(value).toISOString();
}
