import type { ActivityRecord } from "../activity-file/parse.js";
import { tidy, type DataChannels } from "../tools/common.js";

/** NP's rolling average spans 30 s; a shorter window has no NP. */
export const NP_WINDOW_SEC = 30;

export interface WindowOptions {
  channels: DataChannels;
  /** The Activity snapshot's FTP. Without one, %FTP is left out: there is no fallback. */
  ftp: number | undefined;
}

/** One window's stats. A stat the data can't support is left out, never 0. */
export interface WindowStats {
  start_sec: number;
  end_sec: number;
  avg_power_w?: number;
  np_w?: number;
  max_power_w?: number;
  avg_power_pct_ftp?: number;
  avg_hr_bpm?: number;
  max_hr_bpm?: number;
  avg_cadence_rpm?: number;
  avg_speed_m_s?: number;
  distance_m?: number;
  climbing_m?: number;
}

/**
 * One window's stats, from the Activity file's 1 Hz records with `startSec <= sec < endSec`.
 * A channel the Activity doesn't have is left out, never reported as 0.
 */
export function windowStats(
  records: ActivityRecord[],
  startSec: number,
  endSec: number,
  { channels, ftp }: WindowOptions,
): WindowStats {
  let from = records.findIndex((r) => r.sec >= startSec);
  if (from === -1) from = records.length;
  let to = records.findIndex((r) => r.sec >= endSec);
  if (to === -1) to = records.length;
  const window = records.slice(from, to);
  // Distance and climbing are measured from the last record before the window, so splits add up.
  const before = records[from - 1] ?? window[0];

  const stats: WindowStats = { start_sec: startSec, end_sec: endSec };
  if (window.length === 0) return stats;

  if (channels.power) {
    // A second without a power reading is a second at 0 W: zeros count.
    const power = window.map((r) => r.power ?? 0);
    const avg = mean(power);
    stats.avg_power_w = tidy(avg);
    stats.np_w = tidy(normalizedPower(power));
    stats.max_power_w = Math.max(...power);
    if (ftp) stats.avg_power_pct_ftp = Math.round((avg / ftp) * 100);
  }
  if (channels.heart_rate) {
    const hr = window.flatMap((r) => (r.heartRate == null ? [] : [r.heartRate]));
    if (hr.length > 0) {
      stats.avg_hr_bpm = tidy(mean(hr));
      stats.max_hr_bpm = Math.max(...hr);
    }
  }
  // Coasting counts, as in Rouvy's own average cadence.
  if (channels.cadence) stats.avg_cadence_rpm = tidy(mean(window.map((r) => r.cadence ?? 0)));
  if (channels.speed) stats.avg_speed_m_s = tidy(mean(window.map((r) => r.speed ?? 0)));

  const last = window[window.length - 1]!;
  if (last.distance != null && before?.distance != null) stats.distance_m = tidy(last.distance - before.distance);
  stats.climbing_m = tidy(climbing([before!, ...window]));
  return stats;
}

/**
 * The best average power over each duration that fits in the window, keyed by its label
 * (1 Hz records; zeros count).
 */
export function bestEfforts(
  records: ActivityRecord[],
  startSec: number,
  endSec: number,
  durations: readonly (readonly [string, number])[],
): Record<string, number> {
  const power = records.filter((r) => r.sec >= startSec && r.sec < endSec).map((r) => r.power ?? 0);
  const efforts: Record<string, number> = {};
  for (const [label, durationSec] of durations) {
    if (durationSec > power.length) continue;
    let sum = power.slice(0, durationSec).reduce((total, w) => total + w, 0);
    let best = sum;
    for (let i = durationSec; i < power.length; i++) {
      sum += power[i]! - power[i - durationSec]!;
      best = Math.max(best, sum);
    }
    efforts[label] = tidy(best / durationSec)!;
  }
  return efforts;
}

/**
 * HR:power decoupling (Pw:HR): how much less power each heartbeat bought in the second half than
 * in the first, in percent. Positive means heart rate drifted up for the same power.
 */
export function decoupling(first: WindowStats, second: WindowStats): number | undefined {
  const { avg_power_w: p1, avg_hr_bpm: h1 } = first;
  const { avg_power_w: p2, avg_hr_bpm: h2 } = second;
  // The first half's ratio is the divisor, so it needs real numbers; 0 W in the second half is a result.
  if (!p1 || !h1 || p2 == null || !h2) return undefined;
  const ratio1 = p1 / h1;
  return tidy(((ratio1 - p2 / h2) / ratio1) * 100);
}

/** 4th root of the mean of the 4th power of the 30 s rolling average power (1 Hz samples). */
export function normalizedPower(power: number[]): number | undefined {
  if (power.length < NP_WINDOW_SEC) return undefined;
  let rolling = power.slice(0, NP_WINDOW_SEC).reduce((sum, w) => sum + w, 0);
  let sumOfFourthPowers = (rolling / NP_WINDOW_SEC) ** 4;
  for (let i = NP_WINDOW_SEC; i < power.length; i++) {
    rolling += power[i]! - power[i - NP_WINDOW_SEC]!;
    sumOfFourthPowers += (rolling / NP_WINDOW_SEC) ** 4;
  }
  return (sumOfFourthPowers / (power.length - NP_WINDOW_SEC + 1)) ** 0.25;
}

/** Metres gained: the sum of every rise in altitude. None without any altitude. */
function climbing(records: ActivityRecord[]): number | undefined {
  let gained: number | undefined;
  let previous: number | undefined;
  for (const { altitude } of records) {
    if (altitude == null) continue;
    gained ??= 0;
    if (previous !== undefined && altitude > previous) gained += altitude - previous;
    previous = altitude;
  }
  return gained;
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
