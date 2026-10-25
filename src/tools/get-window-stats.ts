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

/** The shortest of Rouvy's power peaks: a shorter window has no best effort. */
const SHORTEST_PEAK_SEC = POWER_PEAKS[0][1];

/**
 * One stretch of an Activity, from its Activity file: the same stats as a split, plus the best
 * efforts that fit in it, its two halves side by side (the client compares them), and HR:power
 * decoupling between them.
 */
export async function getWindowStats(rouvy: RouvyClient, { activity_id, start_sec, end_sec }: GetWindowStatsInput) {
  // Before any request: the input schema can't compare two fields.
  if (end_sec <= start_sec) throw new InputError("end_sec must be after start_sec.");
  const { records, options, durationSec, riderSettings, notes } = await loadActivityFile(rouvy, activity_id);
  const { channels } = options;
  if (start_sec >= durationSec) {
    throw new InputError(`start_sec is past the end of this Activity (its Activity file lasts ${durationSec} s).`);
  }
  const endSec = Math.min(end_sec, durationSec);
  if (endSec < end_sec) notes.push(`The Activity file ends at ${durationSec} s: the window ends there.`);

  const stats = windowStats(records, start_sec, endSec, options);
  notes.push(...gapNotes([stats], channels, () => "the window"));

  let halves;
  let drift;
  if (endSec - start_sec < 2) {
    notes.push("The window is too short to split in halves: halves and decoupling left out.");
  } else {
    const middle = start_sec + Math.floor((endSec - start_sec) / 2);
    halves = { first: windowStats(records, start_sec, middle, options), second: windowStats(records, middle, endSec, options) };
    notes.push(...gapNotes([halves.first, halves.second], channels, (count) => (count === 2 ? "both halves" : "one half")));
    drift = channels.power && channels.heart_rate ? decoupling(halves.first, halves.second) : undefined;
    if (drift === undefined) notes.push("Decoupling needs power and heart rate in both halves: left out.");
  }

  let efforts;
  if (channels.power) {
    if (endSec - start_sec < SHORTEST_PEAK_SEC) {
      notes.push(`No best effort fits in a window shorter than ${SHORTEST_PEAK_SEC} s.`);
    } else {
      efforts = bestEfforts(records, start_sec, endSec, POWER_PEAKS);
    }
  }

  return dropEmpty({
    activity_id,
    start_sec,
    end_sec: endSec,
    rider_settings: riderSettings,
    stats,
    best_efforts_w: efforts,
    halves,
    decoupling_pct: drift,
    ...(notes.length > 0 && { notes }),
  });
}
