import type { RouvyClient } from "../rouvy/client.js";
import type { ActivityDetail, Aggregates, MinMaxAvg } from "../rouvy/schemas.js";

export interface GetActivityInput {
  activity_id: string;
}

/** Rouvy's `PP`, in order. */
const POWER_PEAKS = [
  ["5s", 5],
  ["30s", 30],
  ["1min", 60],
  ["5min", 300],
  ["20min", 1200],
  ["30min", 1800],
  ["60min", 3600],
] as const;

/**
 * One Activity's summary: Rouvy's own numbers, as Rouvy gives them, so they match the Rouvy app.
 * Rider settings come from the Activity snapshot, never from the rider's current settings.
 */
export async function getActivity(rouvy: RouvyClient, { activity_id }: GetActivityInput) {
  const { activity, exportLink } = await rouvy.getActivity(activity_id);
  const total = activity.total ?? {};
  const snapshot = activity.user ?? {};
  const notes: string[] = [];
  const leftOut = (what: string): undefined => {
    notes.push(`Rouvy gave no ${what}; left out.`);
  };

  const has = {
    power: hasData(total.aggrs?.pwrW),
    heart_rate: hasData(total.aggrs?.hr),
    cadence: hasData(total.aggrs?.cadRPM),
    speed: hasData(total.aggrs?.spdMs),
  };
  const ftp = snapshot.FTP || undefined;
  const powerZones = zoneRanges(snapshot.zones?.pwr);
  const hrZones = zoneRanges(snapshot.zones?.hr);

  if (!has.power) {
    notes.push("No power data in this Activity: NP, IF, TSS, power peaks, power stats, %FTP and time in power zones left out.");
  } else if (!ftp) {
    notes.push("The Activity snapshot has no FTP: IF, TSS, %FTP and time in power zones left out.");
  }
  if (!has.power && !ftp) notes.push("The Activity snapshot has no FTP; left out.");
  if (!has.heart_rate) notes.push("No heart-rate data in this Activity: heart-rate stats and time in HR zones left out.");
  if (!has.cadence) notes.push("No cadence data in this Activity: cadence stats left out.");
  if (!has.speed) notes.push("No speed data in this Activity: speed stats left out.");
  const usesFtp = has.power && ftp !== undefined;

  const summary: Record<string, unknown> = {
    id: activity.id,
    title: activity.title,
    type: activity.training,
    start: activity.startUTC,
    elapsed_time_sec: total.elapsedTimeSec,
    moving_time_sec: total.movingTimeSec,
    distance_m: total.distM,
    elevation_m: total.elevM,
    kcal: total.kCal,
  };
  for (const [field, value] of Object.entries(summary)) if (value == null) leftOut(field);

  if (has.power) {
    summary.np_w = total.NP ?? leftOut("NP");
    if (usesFtp) {
      summary.if = total.IF ?? leftOut("IF");
      summary.tss = total.TSS ?? leftOut("TSS");
    }
    summary.power_peaks_w = powerPeaks(total.PP, total.elapsedTimeSec, notes);
    summary.power_w = minMaxAvg(total.aggrs?.pwrW);
    if (usesFtp && total.aggrs?.pwrW?.avg != null) summary.avg_power_pct_ftp = Math.round((total.aggrs.pwrW.avg / ftp) * 100);
  }
  if (has.heart_rate) summary.heart_rate_bpm = minMaxAvg(total.aggrs?.hr);
  if (has.cadence) summary.cadence_rpm = minMaxAvg(total.aggrs?.cadRPM);
  if (has.speed) summary.speed_m_s = minMaxAvg(total.aggrs?.spdMs);

  if (usesFtp) summary.time_in_power_zones_sec = timeInZones(total.hists?.pwr, powerZones, "power", notes);
  if (has.heart_rate) summary.time_in_hr_zones_sec = timeInZones(total.hists?.hr, hrZones, "HR", notes);

  summary.laps = (activity.laps ?? []).map((lap) => ({
    name: lap.name,
    start_sec: tidy(lap.startOffsetSec),
    duration_sec: tidy(lap.elapsedTimeSec),
    distance_m: tidy(lap.distM),
    ...aggregates(lap.aggrs, has),
    target_power_w: lap.targetPower ?? undefined,
  }));
  summary.segments = segments(activity, has);

  const riderSettings: Record<string, unknown> = {
    source: "Activity snapshot",
    ftp_w: ftp,
    weight_kg: snapshot.weightKg ?? undefined,
    max_hr_bpm: snapshot.maxHr || undefined,
    power_zones_w: powerZones,
    hr_zones_bpm: hrZones,
  };
  for (const [field, value] of Object.entries(riderSettings)) {
    if (value === undefined && field !== "ftp_w") notes.push(`The Activity snapshot has no ${field}; left out.`);
  }
  summary.rider_settings = riderSettings;

  const activityFile = exportLink != null && exportLink !== "";
  if (!activityFile) {
    notes.push("No Activity file: intervals, window stats, streams and export aren't available for this Activity.");
  }
  summary.available_fields = { ...has, activity_file: activityFile };
  if (notes.length > 0) summary.notes = notes;

  return dropEmpty(summary);
}

/** Whether a data channel was recorded at all. Rouvy reports a missing sensor as zeros or nothing. */
function hasData(stats: MinMaxAvg): boolean {
  return (stats?.max ?? 0) > 0;
}

function minMaxAvg(stats: MinMaxAvg) {
  return { min: tidy(stats?.min), max: tidy(stats?.max), avg: tidy(stats?.avg) };
}

function aggregates(aggrs: Aggregates, has: Record<"power" | "heart_rate" | "cadence" | "speed", boolean>) {
  return {
    power_w: has.power ? minMaxAvg(aggrs?.pwrW) : undefined,
    heart_rate_bpm: has.heart_rate ? minMaxAvg(aggrs?.hr) : undefined,
    cadence_rpm: has.cadence ? minMaxAvg(aggrs?.cadRPM) : undefined,
    speed_m_s: has.speed ? minMaxAvg(aggrs?.spdMs) : undefined,
  };
}

function powerPeaks(peaks: (number | null | undefined)[] | null | undefined, elapsedSec: number | null | undefined, notes: string[]) {
  const out: Record<string, number> = {};
  POWER_PEAKS.forEach(([label, durationSec], i) => {
    const watts = peaks?.[i];
    if (watts) out[label] = watts;
    else if (elapsedSec != null && elapsedSec < durationSec) notes.push(`No ${label} power peak: the Activity is shorter than that.`);
    else notes.push(`Rouvy gave no ${label} power peak; left out.`);
  });
  return out;
}

/**
 * Rouvy stores 7 zone tops; the last one is a sentinel (e.g. 6000 W, 300 bpm), so zone 7 is open-ended.
 */
function zoneRanges(tops: number[] | null | undefined) {
  if (!tops?.length) return undefined;
  return tops.map((top, i) => ({ zone: i + 1, from: i === 0 ? 0 : tops[i - 1]!, ...(i < tops.length - 1 && { to: top }) }));
}

function timeInZones(seconds: number[] | null | undefined, zones: unknown[] | undefined, kind: string, notes: string[]) {
  if (!seconds?.length) {
    notes.push(`Rouvy gave no time in ${kind} zones; left out.`);
    return undefined;
  }
  if (!zones) notes.push(`The Activity snapshot has no ${kind} zones: time in ${kind} zones is by zone number only.`);
  return seconds.map((sec, i) => ({ zone: i + 1, sec: tidy(sec) }));
}

/** Route segment results: Rouvy's passes, named from the route's own segment list. */
function segments(activity: ActivityDetail["activity"], has: Record<"heart_rate", boolean>) {
  const byId = new Map((activity.route?.segments ?? []).map((segment) => [segment.id, segment]));
  return (activity.segmentsPasses ?? []).map((pass) => {
    const segment = byId.get(pass.id);
    return {
      name: segment?.name,
      type: segment?.type,
      distance_m: tidy(segment?.distanceMeters),
      elevation_m: tidy(segment?.elevationMeters),
      avg_grade_pct: tidy(segment?.averageGrade),
      time_sec: tidy(pass.elapsedTimeSeconds),
      avg_power_w: tidy(pass.avgPowerWatts),
      avg_speed_m_s: tidy(pass.avgSpeedMetersPerSecond),
      avg_hr_bpm: has.heart_rate ? tidy(pass.avgHeartRateBPM) : undefined,
    };
  });
}

/** Rouvy's floats carry noise (1802.7200000000003): two decimals are plenty. */
function tidy(value: number | null | undefined): number | undefined {
  return value == null ? undefined : Math.round(value * 100) / 100;
}

/** Leaves out every null or undefined value, at any depth, so a missing number never reads as 0. */
function dropEmpty<T>(value: T): T {
  if (Array.isArray(value)) return value.map(dropEmpty) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).filter(([, v]) => v != null).map(([k, v]) => [k, dropEmpty(v)]),
    ) as T;
  }
  return value;
}
