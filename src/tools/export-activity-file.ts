import type { ActivityRecord } from "../activity-file/parse.js";
import type { RouvyClient } from "../rouvy/client.js";
import type { ExportStorage } from "../storage/types.js";

export const EXPORT_FORMATS = ["fit", "csv"] as const;

export interface ExportActivityFileInput {
  activity_id: string;
  format: (typeof EXPORT_FORMATS)[number];
}

/** Writes one Activity's file to the rider's export folder, overwriting an earlier export. */
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
const CSV_COLUMNS: readonly [name: string, key: keyof ActivityRecord, decimals?: number][] = [
  ["sec", "sec"],
  ["timestamp", "timestamp"],
  ["power", "power", 0],
  ["heart_rate", "heartRate", 0],
  ["cadence", "cadence", 0],
  ["speed", "speed", 3],
  ["altitude", "altitude", 1],
  ["distance", "distance", 2],
  ["position_lat", "positionLat", 7],
  ["position_long", "positionLong", 7],
];

/** One row per second; a reading the Activity file doesn't have is an empty cell, never 0. */
function toCsv(records: ActivityRecord[]): string {
  const header = CSV_COLUMNS.map(([name]) => name).join(",");
  const rows = records.map((record) =>
    CSV_COLUMNS.map(([, key, decimals]) => {
      const value = record[key];
      return typeof value === "number" && decimals !== undefined ? Number(value.toFixed(decimals)) : (value ?? "");
    }).join(","),
  );
  return [header, ...rows].join("\n") + "\n";
}
