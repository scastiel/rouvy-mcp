import { LIST_PAGE_SIZE, type RouvyClient } from "../rouvy/client.js";
import type { ActivityListRow } from "../rouvy/schemas.js";
import { activityUrl } from "./common.js";

export interface ListActivitiesInput {
  limit: number;
  offset: number;
}

export async function listActivities(rouvy: RouvyClient, { limit, offset }: ListActivitiesInput) {
  const end = offset + limit;
  const firstPageOffset = Math.floor(offset / LIST_PAGE_SIZE) * LIST_PAGE_SIZE;
  const rows: ActivityListRow[] = [];
  let lastPageFull = false;
  // At most 6 pages: a 50-row window starting mid-page spans 6 pages of 10.
  for (let pageOffset = firstPageOffset; pageOffset < end; pageOffset += LIST_PAGE_SIZE) {
    const page = await rouvy.listActivitiesPage(pageOffset);
    rows.push(...page);
    lastPageFull = page.length === LIST_PAGE_SIZE;
    if (!lastPageFull) break;
  }
  const window = rows.slice(offset - firstPageOffset, end - firstPageOffset).map(toCompactRow);
  const notes = missingFieldNotes(window);
  return {
    activities: window,
    // "May exist": a full last page doesn't prove there's another row.
    has_more: firstPageOffset + rows.length > end || lastPageFull,
    ...(notes.length > 0 && { notes }),
  };
}

const OPTIONAL_FIELDS = ["title", "type", "moving_time_sec", "distance_m", "elevation_m", "tss", "if"] as const;

function toCompactRow(row: ActivityListRow) {
  const compact = {
    id: row.id,
    url: activityUrl(row.id),
    title: row.title,
    type: row.training,
    start: row.startUTC,
    moving_time_sec: row.total?.movingTimeSec,
    distance_m: row.total?.distM,
    elevation_m: row.total?.elevM,
    tss: row.total?.tss,
    if: row.total?.if,
  };
  return Object.fromEntries(Object.entries(compact).filter(([, value]) => value != null)) as Partial<typeof compact> &
    Pick<typeof compact, "id" | "url" | "start">;
}

function missingFieldNotes(rows: ReturnType<typeof toCompactRow>[]): string[] {
  return OPTIONAL_FIELDS.flatMap((field) => {
    const missing = rows.filter((row) => !(field in row)).length;
    if (missing === 0) return [];
    return [`Rouvy gave no ${field} for ${missing} ${missing === 1 ? "Activity" : "Activities"}; left out.`];
  });
}
