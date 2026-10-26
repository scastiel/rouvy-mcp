import { z } from "zod";
import { apiChanged } from "./errors.js";

export const LIST_ROUTE = "routes/resources.activities-pagination";

const activityListRow = z.object({
  id: z.string(),
  startUTC: z.string(),
  // Optional: Rouvy may omit them or send null; either way they're left out with a note.
  title: z.string().nullish(),
  training: z.string().nullish(),
  total: z
    .object({
      distM: z.number().nullish(),
      elevM: z.number().nullish(),
      movingTimeSec: z.number().nullish(),
      tss: z.number().nullish(),
      if: z.number().nullish(),
    })
    .nullish(),
});

const activityListPayload = z.object({
  [LIST_ROUTE]: z.object({ data: z.object({ activities: z.array(activityListRow) }) }),
});

export type ActivityListRow = z.infer<typeof activityListRow>;

/** Lenient: unknown keys are ignored; a missing required field means Rouvy changed its API. */
export function parseActivityListPage(payload: unknown): ActivityListRow[] {
  const result = activityListPayload.safeParse(payload);
  if (!result.success) {
    const path = result.error.issues[0]?.path ?? [];
    throw apiChanged(LIST_ROUTE, describePath(path.slice(1)));
  }
  return result.data[LIST_ROUTE].data.activities;
}

/** `a.b[2].c`, the way drift messages name a field. */
export function describePath(path: PropertyKey[]): string {
  return path.reduce<string>(
    (out, key) => (typeof key === "number" ? `${out}[${key}]` : out ? `${out}.${String(key)}` : String(key)),
    "",
  );
}

export const DETAIL_ROUTE = "routes/_main.activity.$id";

const minMaxAvg = z.object({ min: z.number().nullish(), max: z.number().nullish(), avg: z.number().nullish() }).nullish();

const aggregates = z
  .object({ pwrW: minMaxAvg, hr: minMaxAvg, cadRPM: minMaxAvg, spdMs: minMaxAvg })
  .nullish();

const activityDetail = z.object({
  activity: z.object({
    id: z.string(),
    startUTC: z.string(),
    title: z.string().nullish(),
    training: z.string().nullish(),
    // The Activity snapshot: the Rider settings Rouvy stored with this Activity.
    user: z
      .object({
        FTP: z.number().nullish(),
        weightKg: z.number().nullish(),
        maxHr: z.number().nullish(),
        zones: z.object({ hr: z.array(z.number()).nullish(), pwr: z.array(z.number()).nullish() }).nullish(),
      })
      .nullish(),
    total: z
      .object({
        elapsedTimeSec: z.number().nullish(),
        movingTimeSec: z.number().nullish(),
        distM: z.number().nullish(),
        elevM: z.number().nullish(),
        kCal: z.number().nullish(),
        NP: z.number().nullish(),
        IF: z.number().nullish(),
        TSS: z.number().nullish(),
        PP: z.array(z.number().nullish()).nullish(),
        aggrs: aggregates,
        hists: z.object({ hr: z.array(z.number()).nullish(), pwr: z.array(z.number()).nullish() }).nullish(),
      })
      .nullish(),
    laps: z
      .array(
        z.object({
          name: z.string().nullish(),
          startOffsetSec: z.number().nullish(),
          elapsedTimeSec: z.number().nullish(),
          distM: z.number().nullish(),
          aggrs: aggregates,
          targetPower: z.number().nullish(),
        }),
      )
      .nullish(),
    segmentsPasses: z
      .array(
        z.object({
          id: z.string(),
          elapsedTimeSeconds: z.number().nullish(),
          avgPowerWatts: z.number().nullish(),
          avgSpeedMetersPerSecond: z.number().nullish(),
          avgHeartRateBPM: z.number().nullish(),
        }),
      )
      .nullish(),
    route: z
      .object({
        segments: z
          .array(
            z.object({
              id: z.string(),
              name: z.string().nullish(),
              type: z.string().nullish(),
              distanceMeters: z.number().nullish(),
              elevationMeters: z.number().nullish(),
              averageGrade: z.number().nullish(),
            }),
          )
          .nullish(),
      })
      .nullish(),
  }),
  // Required, but null when Rouvy offers no Activity file. A capability URL: never shown.
  exportLink: z.string().nullable(),
});

const activityDetailPayload = z.object({ [DETAIL_ROUTE]: z.object({ data: activityDetail }) });

export type ActivityDetail = z.infer<typeof activityDetail>;
export type MinMaxAvg = z.infer<typeof minMaxAvg>;
export type Aggregates = z.infer<typeof aggregates>;

/** Only the Activity's own route data is read; the current Rider settings (`userData`) never are. */
export function parseActivityDetail(payload: unknown): ActivityDetail {
  const result = activityDetailPayload.safeParse(payload);
  if (!result.success) {
    const path = result.error.issues[0]?.path ?? [];
    throw apiChanged(DETAIL_ROUTE, describePath(path.slice(2)));
  }
  return result.data[DETAIL_ROUTE].data;
}
