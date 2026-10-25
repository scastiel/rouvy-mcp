import type { RouvyClient } from "../rouvy/client.js";
import { NP_WINDOW_SEC, windowStats } from "../stats/window.js";
import { dataChannels, dropEmpty } from "./common.js";

export interface GetActivityIntervalsInput {
  activity_id: string;
  every_sec: number;
}

/**
 * Fixed-size splits of one Activity, computed from its Activity file. %FTP uses the Activity
 * snapshot's FTP: the one Rouvy stored with this Activity, never the rider's current one.
 */
export async function getActivityIntervals(rouvy: RouvyClient, { activity_id, every_sec }: GetActivityIntervalsInput) {
  const { records } = await rouvy.getActivityFile(activity_id);
  const { activity } = await rouvy.getActivity(activity_id);
  const channels = dataChannels(activity.total?.aggrs);
  const ftp = activity.user?.FTP || undefined;

  const notes: string[] = [];
  if (!channels.power) notes.push("No power data in this Activity: power stats and %FTP left out.");
  else if (!ftp) notes.push("The Activity snapshot has no FTP: %FTP left out.");
  if (!channels.heart_rate) notes.push("No heart-rate data in this Activity: heart-rate stats left out.");
  if (!channels.cadence) notes.push("No cadence data in this Activity: cadence stats left out.");
  if (!channels.speed) notes.push("No speed data in this Activity: speed stats left out.");

  const durationSec = records.length > 0 ? records[records.length - 1]!.sec + 1 : 0;
  const splits = [];
  for (let start = 0; start < durationSec; start += every_sec) {
    splits.push(windowStats(records, start, Math.min(start + every_sec, durationSec), { channels, ftp }));
  }
  if (channels.power && splits.some((split) => split.end_sec! - split.start_sec! < NP_WINDOW_SEC)) {
    notes.push(`NP needs at least ${NP_WINDOW_SEC} s of data: left out of splits shorter than that.`);
  }

  return dropEmpty({
    activity_id,
    every_sec,
    duration_sec: durationSec,
    rider_settings: { source: "Activity snapshot", ftp_w: ftp },
    splits,
    ...(notes.length > 0 && { notes }),
  });
}
