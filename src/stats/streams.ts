import type { ActivityRecord } from "../activity-file/parse.js";
import { tidy } from "../tools/common.js";

export const STREAM_FIELDS = ["power", "heart_rate", "cadence", "speed", "altitude", "distance"] as const;
export type StreamField = (typeof STREAM_FIELDS)[number];

const RECORD_KEY = {
  power: "power",
  heart_rate: "heartRate",
  cadence: "cadence",
  speed: "speed",
  altitude: "altitude",
  distance: "distance",
} as const satisfies Record<StreamField, keyof ActivityRecord>;

/**
 * Power, cadence and speed count a second without a reading as 0, as the split stats do (zeros
 * count). The others average only the readings there are.
 */
const ZEROS_COUNT: ReadonlySet<StreamField> = new Set(["power", "cadence", "speed"]);

/** Whether any record carries this field. */
export function hasReadings(records: ActivityRecord[], field: StreamField): boolean {
  return records.some((record) => record[RECORD_KEY[field]] != null);
}

/**
 * One column per field: the mean of each `resolutionSec` bucket of the records with
 * `startSec <= sec < endSec`, the last bucket shorter when the window doesn't divide evenly.
 * A bucket with nothing to average is null, never 0.
 */
export function streams(
  records: ActivityRecord[],
  startSec: number,
  endSec: number,
  resolutionSec: number,
  fields: readonly StreamField[],
): Partial<Record<StreamField, (number | null)[]>> {
  const buckets = Math.ceil((endSec - startSec) / resolutionSec);
  const sums = fields.map(() => new Array<number>(buckets).fill(0));
  const counts = fields.map(() => new Array<number>(buckets).fill(0));
  const seconds = new Array<number>(buckets).fill(0);

  for (const record of records) {
    if (record.sec < startSec || record.sec >= endSec) continue;
    const bucket = Math.floor((record.sec - startSec) / resolutionSec);
    seconds[bucket]!++;
    fields.forEach((field, i) => {
      const value = record[RECORD_KEY[field]];
      if (value == null) return;
      sums[i]![bucket]! += value;
      counts[i]![bucket]!++;
    });
  }

  return Object.fromEntries(
    fields.map((field, i) => {
      const divisors = ZEROS_COUNT.has(field) ? seconds : counts[i]!;
      return [field, sums[i]!.map((sum, bucket) => (divisors[bucket] ? tidy(sum / divisors[bucket]!)! : null))];
    }),
  );
}
