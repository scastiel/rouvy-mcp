import FitParser from "fit-file-parser";
import { apiChanged } from "../rouvy/errors.js";

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
  session?: { startTime?: string; totalElapsedTimeSec?: number };
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

  const firstMs = fit.records?.[0]?.timestamp ? toMs(fit.records[0].timestamp) : 0;
  const records = (fit.records ?? []).flatMap((record): ActivityRecord[] => {
    if (record.timestamp == null) return [];
    const ms = toMs(record.timestamp);
    return [
      dropUndefined({
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
      }),
    ];
  });
  const session = fit.sessions?.[0];
  return {
    records,
    ...(session && {
      session: dropUndefined({
        startTime: isoOrUndefined(session.start_time),
        totalElapsedTimeSec: session.total_elapsed_time,
      }),
    }),
    laps: (fit.laps ?? []).map((lap) =>
      dropUndefined({
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

function dropUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v != null)) as T;
}
