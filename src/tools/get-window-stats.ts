import type { RouvyClient } from "../rouvy/client.js";
import { bestEfforts, decoupling, windowStats } from "../stats/window.js";
import { gapNotes, loadActivityFile } from "./activity-file-analysis.js";
import { dropEmpty, POWER_PEAKS } from "./common.js";
import { InputError } from "./errors.js";

export interface GetWindowStatsInput {
  activity_id: string;
  start_sec: number;
  end_sec: number;
}

/**
 * One stretch of an Activity, from its Activity file: the same stats as a split, plus the best
 * efforts that fit in it, its two halves side by side, and HR:power decoupling between them.
 */
export async function getWindowStats(rouvy: RouvyClient, { activity_id, start_sec, end_sec }: GetWindowStatsInput) {
  const { records, channels, ftp, durationSec, riderSettings, notes } = await loadActivityFile(rouvy, activity_id);
  if (start_sec >= durationSec) {
    throw new InputError(`start_sec is past the end of this Activity (its Activity file lasts ${durationSec} s).`);
  }
  const endSec = Math.min(end_sec, durationSec);
  if (endSec < end_sec) notes.push(`The Activity file ends at ${durationSec} s: the window ends there.`);

  const options = { channels, ftp };
  const stats = windowStats(records, start_sec, endSec, options);
  const middle = start_sec + Math.floor((endSec - start_sec) / 2);
  const first = windowStats(records, start_sec, middle, options);
  const second = windowStats(records, middle, endSec, options);
  const drift = channels.power && channels.heart_rate ? decoupling(first, second) : undefined;

  notes.push(...gapNotes([stats], channels, () => "the window"));
  notes.push(...gapNotes([first, second], channels, (count) => (count === 2 ? "both halves" : "one half")));
  if (drift === undefined) notes.push("Decoupling needs power and heart rate in both halves: left out.");

  return dropEmpty({
    activity_id,
    start_sec,
    end_sec: endSec,
    rider_settings: riderSettings,
    stats,
    best_efforts_w: channels.power ? bestEfforts(records, start_sec, endSec, POWER_PEAKS) : undefined,
    halves: { first, second },
    decoupling_pct: drift,
    ...(notes.length > 0 && { notes }),
  });
}
