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

function describePath(path: PropertyKey[]): string {
  return path.reduce<string>(
    (out, key) => (typeof key === "number" ? `${out}[${key}]` : out ? `${out}.${String(key)}` : String(key)),
    "",
  );
}
