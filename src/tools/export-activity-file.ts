import type { ActivityRecord } from "../activity-file/parse.js";
import type { RouvyClient } from "../rouvy/client.js";
import { RECORD_KEY, STREAM_FIELDS } from "../stats/streams.js";
import type { ExportStorage } from "../storage/types.js";

export const EXPORT_FORMATS = ["fit", "csv"] as const;

export interface ExportActivityFileInput {
  activity_id: string;
  format: (typeof EXPORT_FORMATS)[number];
}

/** Writes one Activity's Activity file, or its records as CSV, to the rider's export folder, overwriting an earlier export. */
export async function exportActivityFile(
  rouvy: RouvyClient,
  storage: ExportStorage,
  { activity_id, format }: ExportActivityFileInput,
) {
  const file = await rouvy.getActivityFile(activity_id);
  const contents = format === "fit" ? file.bytes : toCsv(file.records);
  const path = await storage.write(`${activity_id}.${format}`, contents);
  return { activity_id, format, path };
}

/**
 * Units: power W, heart_rate bpm, cadence rpm, speed m/s, altitude m, distance m from the start,
 * positions in degrees. Decimals are FIT's own resolution for each field: anything finer is float
 * noise from its scaling (100.39999999999998 m).
 */
const DECIMALS: Partial<Record<keyof ActivityRecord, number>> = {
  power: 0,
  heartRate: 0,
  cadence: 0,
  speed: 3,
  altitude: 1,
  distance: 2,
  positionLat: 7,
  positionLong: 7,
};

/** get_activity_streams' fields, named the same, between the time and the position. */
const CSV_COLUMNS: readonly (readonly [name: string, key: keyof ActivityRecord])[] = [
  ["sec", "sec"],
  ["timestamp", "timestamp"],
  ...STREAM_FIELDS.map((field) => [field, RECORD_KEY[field]] as const),
  ["position_lat", "positionLat"],
  ["position_long", "positionLong"],
];

/** One row per second; a reading the Activity file doesn't have is an empty cell, never 0. */
function toCsv(records: ActivityRecord[]): string {
  const header = CSV_COLUMNS.map(([name]) => name).join(",");
  const rows = records.map((record) =>
    CSV_COLUMNS.map(([, key]) => {
      const value = record[key];
      const decimals = DECIMALS[key];
      return typeof value === "number" && decimals !== undefined ? Number(value.toFixed(decimals)) : (value ?? "");
    }).join(","),
  );
  return [header, ...rows].join("\n") + "\n";
}
