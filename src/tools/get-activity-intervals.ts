import type { RouvyClient } from "../rouvy/client.js";
import { windowStats, type WindowStats } from "../stats/window.js";
import { gapNotes, loadActivityFile } from "./activity-file-analysis.js";
import { dropEmpty } from "./common.js";

export interface GetActivityIntervalsInput {
  activity_id: string;
  every_sec: number;
}

/**
 * Fixed-size splits of one Activity, computed from its Activity file. %FTP uses the Activity
 * snapshot's FTP: the one Rouvy stored with this Activity, never the rider's current one.
 */
export async function getActivityIntervals(rouvy: RouvyClient, { activity_id, every_sec }: GetActivityIntervalsInput) {
  const { records, channels, ftp, durationSec, riderSettings, notes } = await loadActivityFile(rouvy, activity_id);

  const splits: WindowStats[] = [];
  for (let start = 0; start < durationSec; start += every_sec) {
    splits.push(windowStats(records, start, Math.min(start + every_sec, durationSec), { channels, ftp }));
  }
  const of = `of ${splits.length} ${splits.length === 1 ? "split" : "splits"}`;
  notes.push(...gapNotes(splits, channels, (count) => `${count} ${of}`));

  return dropEmpty({
    activity_id,
    every_sec,
    duration_sec: durationSec,
    rider_settings: riderSettings,
    splits,
    ...(notes.length > 0 && { notes }),
  });
}
