import type { RouvyClient } from "../rouvy/client.js";
import { hasReadings, streams, type StreamField } from "../stats/streams.js";
import { loadActivityFile } from "./activity-file-analysis.js";
import { dropEmpty, type DataChannels } from "./common.js";
import { InputError } from "./errors.js";

export interface GetActivityStreamsInput {
  activity_id: string;
  fields: StreamField[];
  resolution_sec: number;
  start_sec?: number;
  end_sec?: number;
}

/** Per field, per call: enough to chart, small enough to keep raw rows out of the conversation. */
export const MAX_STREAM_POINTS = 500;

const CHANNEL_LABEL: Record<keyof DataChannels, string> = {
  power: "power",
  heart_rate: "heart-rate",
  cadence: "cadence",
  speed: "speed",
};

/** A downsampled view of an Activity file's per-second records, never the raw rows. */
export async function getActivityStreams(
  rouvy: RouvyClient,
  { activity_id, fields, resolution_sec, start_sec = 0, end_sec }: GetActivityStreamsInput,
) {
  // Before any request: the input schema can't compare two fields.
  if (end_sec !== undefined && end_sec <= start_sec) throw new InputError("end_sec must be after start_sec.");
  const { records, durationSec, options } = await loadActivityFile(rouvy, activity_id);
  if (start_sec >= durationSec) {
    throw new InputError(`start_sec is past the end of this Activity (its Activity file lasts ${durationSec} s).`);
  }
  const endSec = Math.min(end_sec ?? durationSec, durationSec);
  const notes: string[] = [];
  if (end_sec !== undefined && endSec < end_sec) {
    notes.push(`The Activity file ends at ${durationSec} s: the streams end there.`);
  }

  // Rouvy's channels decide, as in get_activity's available_fields; a field no record carries is missing too.
  const present: StreamField[] = [];
  const missing: StreamField[] = [];
  for (const field of new Set(fields)) {
    if (field in CHANNEL_LABEL && !options.channels[field as keyof DataChannels]) {
      notes.push(`No ${CHANNEL_LABEL[field as keyof DataChannels]} data in this Activity: ${field} left out.`);
      missing.push(field);
    } else if (!hasReadings(records, field)) {
      notes.push(`The Activity file has no ${field}: ${field} left out.`);
      missing.push(field);
    } else {
      present.push(field);
    }
  }

  // ceil(length / resolution) <= MAX ⇔ resolution >= length / MAX: the smallest whole one that fits.
  const resolutionSec = Math.max(resolution_sec, Math.ceil((endSec - start_sec) / MAX_STREAM_POINTS));
  if (resolutionSec > resolution_sec) {
    notes.push(`At most ${MAX_STREAM_POINTS} points per field: served at ${resolutionSec} s instead of ${resolution_sec} s.`);
  }

  return dropEmpty({
    activity_id,
    start_sec,
    end_sec: endSec,
    resolution_sec_used: resolutionSec,
    streams: streams(records, start_sec, endSec, resolutionSec, present),
    ...(missing.length > 0 && { missing_fields: missing }),
    ...(notes.length > 0 && { notes }),
  });
}
