import type { RouvyClient } from "../rouvy/client.js";
import { NP_WINDOW_SEC, windowStats, type WindowStats } from "../stats/window.js";
import { dataChannels, dropEmpty, type DataChannels } from "./common.js";

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

  const durationSec = records[records.length - 1]!.sec + 1;
  const splits: WindowStats[] = [];
  for (let start = 0; start < durationSec; start += every_sec) {
    splits.push(windowStats(records, start, Math.min(start + every_sec, durationSec), { channels, ftp }));
  }
  notes.push(...gapNotes(splits, channels));

  return dropEmpty({
    activity_id,
    every_sec,
    duration_sec: durationSec,
    rider_settings: { source: "Activity snapshot", ftp_w: ftp },
    splits,
    ...(notes.length > 0 && { notes }),
  });
}

/** A note for each stat the Activity has, but that some splits leave out: no data there in the file. */
function gapNotes(splits: WindowStats[], channels: DataChannels): string[] {
  const missing = (field: keyof WindowStats) => splits.filter((split) => split[field] === undefined).length;
  const of = (count: number) => `${count} of ${splits.length} ${splits.length === 1 ? "split" : "splits"}`;
  const notes: string[] = [];
  const npMissing = channels.power ? missing("np_w") - missing("avg_power_w") : 0;
  if (npMissing > 0) notes.push(`NP needs at least ${NP_WINDOW_SEC} s of data: left out of ${of(npMissing)}.`);
  const gaps: [keyof WindowStats, string, boolean][] = [
    ["avg_power_w", "power", channels.power],
    ["avg_hr_bpm", "heart rate", channels.heart_rate],
    ["distance_m", "distance", true],
    ["climbing_m", "altitude (climbing)", true],
  ];
  for (const [field, label, expected] of gaps) {
    const count = expected ? missing(field) : 0;
    if (count > 0) notes.push(`The Activity file has no ${label} for ${of(count)}: left out there.`);
  }
  return notes;
}
