import type { Aggregates, MinMaxAvg } from "../rouvy/schemas.js";

/** Rouvy's `PP` durations, in order: the power peaks it reports, and the best efforts we look for. */
export const POWER_PEAKS = [
  ["5s", 5],
  ["30s", 30],
  ["1min", 60],
  ["5min", 300],
  ["20min", 1200],
  ["30min", 1800],
  ["60min", 3600],
] as const;

export type DataChannels = Record<"power" | "heart_rate" | "cadence" | "speed", boolean>;

/**
 * Which data channels an Activity has, from Rouvy's own aggregates, so every tool agrees with
 * get_activity's `available_fields`. Rouvy reports a missing sensor as zeros or nothing.
 */
export function dataChannels(aggrs: Aggregates): DataChannels {
  return {
    power: hasData(aggrs?.pwrW),
    heart_rate: hasData(aggrs?.hr),
    cadence: hasData(aggrs?.cadRPM),
    speed: hasData(aggrs?.spdMs),
  };
}

function hasData(stats: MinMaxAvg): boolean {
  return (stats?.max ?? 0) > 0;
}

/** Floats carry noise (1802.7200000000003): two decimals are plenty. */
export function tidy(value: number | null | undefined): number | undefined {
  return value == null ? undefined : Math.round(value * 100) / 100;
}

/** Leaves out every null or undefined value, at any depth, so a missing number never reads as 0. */
export function dropEmpty<T>(value: T): T {
  if (Array.isArray(value)) return value.map(dropEmpty) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).filter(([, v]) => v != null).map(([k, v]) => [k, dropEmpty(v)]),
    ) as T;
  }
  return value;
}
