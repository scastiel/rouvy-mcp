import type { ActivityRecord } from "../activity-file/parse.js";
import { tidy, type DataChannels } from "../tools/common.js";

/** NP's rolling average spans 30 s; a shorter window has no NP. */
export const NP_WINDOW_SEC = 30;

export interface WindowOptions {
  channels: DataChannels;
  /** The Activity snapshot's FTP. Without one, %FTP is left out: there is no fallback. */
  ftp: number | undefined;
}

/**
 * One window's stats, from the Activity file's 1 Hz records with `startSec <= sec < endSec`.
 * A channel the Activity doesn't have is left out, never reported as 0.
 */
export function windowStats(records: ActivityRecord[], startSec: number, endSec: number, { channels, ftp }: WindowOptions) {
  let from = records.findIndex((r) => r.sec >= startSec);
  if (from === -1) from = records.length;
  let to = records.findIndex((r) => r.sec >= endSec);
  if (to === -1) to = records.length;
  const window = records.slice(from, to);
  // Distance and climbing are measured from the last record before the window, so splits add up.
  const before = records[from - 1] ?? window[0];

  const stats: Record<string, number | undefined> = { start_sec: startSec, end_sec: endSec };
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

/** Metres gained: the sum of every rise in altitude. */
function climbing(records: ActivityRecord[]): number {
  let gained = 0;
  let previous: number | undefined;
  for (const { altitude } of records) {
    if (altitude == null) continue;
    if (previous !== undefined && altitude > previous) gained += altitude - previous;
    previous = altitude;
  }
  return gained;
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
