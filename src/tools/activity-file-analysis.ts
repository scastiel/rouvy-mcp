import type { RouvyClient } from "../rouvy/client.js";
import { NP_WINDOW_SEC, type WindowStats } from "../stats/window.js";
import { dataChannels, type DataChannels } from "./common.js";

/**
 * What every analysis of an Activity file starts from: its records, which channels the Activity
 * has (as get_activity reports them), and the Activity snapshot's FTP, never the current one.
 */
export async function loadActivityFile(rouvy: RouvyClient, activityId: string) {
  const { records } = await rouvy.getActivityFile(activityId);
  const { activity } = await rouvy.getActivity(activityId);
  const channels = dataChannels(activity.total?.aggrs);
  const ftp = activity.user?.FTP || undefined;

  const notes: string[] = [];
  if (!channels.power) notes.push("No power data in this Activity: power stats and %FTP left out.");
  else if (!ftp) notes.push("The Activity snapshot has no FTP: %FTP left out.");
  if (!channels.heart_rate) notes.push("No heart-rate data in this Activity: heart-rate stats left out.");
  if (!channels.cadence) notes.push("No cadence data in this Activity: cadence stats left out.");
  if (!channels.speed) notes.push("No speed data in this Activity: speed stats left out.");

  return {
    records,
    channels,
    ftp,
    /** The records cover seconds 0 to the last one, inclusive. */
    durationSec: records[records.length - 1]!.sec + 1,
    riderSettings: { source: "Activity snapshot", ftp_w: ftp },
    notes,
  };
}

/**
 * A note for each stat the Activity has, but that some windows leave out: no data there in the
 * file, or too short for NP. `scope` names the windows missing it ("3 of 7 splits", "both halves").
 */
export function gapNotes(windows: WindowStats[], channels: DataChannels, scope: (count: number) => string): string[] {
  const missing = (field: keyof WindowStats) => windows.filter((window) => window[field] === undefined).length;
  const notes: string[] = [];
  const npMissing = channels.power ? missing("np_w") - missing("avg_power_w") : 0;
  if (npMissing > 0) notes.push(`NP needs at least ${NP_WINDOW_SEC} s of data: left out of ${scope(npMissing)}.`);
  const gaps: [keyof WindowStats, string, boolean][] = [
    ["avg_power_w", "power", channels.power],
    ["avg_hr_bpm", "heart rate", channels.heart_rate],
    ["distance_m", "distance", true],
    ["climbing_m", "altitude (climbing)", true],
  ];
  for (const [field, label, expected] of gaps) {
    const count = expected ? missing(field) : 0;
    if (count > 0) notes.push(`The Activity file has no ${label} for ${scope(count)}: left out there.`);
  }
  return notes;
}
