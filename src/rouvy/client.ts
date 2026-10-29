import { parseActivityFile, type ActivityFile } from "../activity-file/parse.js";
import { RIDERS } from "../constants.js";
import { createActivityFileCache } from "./activity-file-cache.js";
import type { Clock } from "./clock.js";
import { createDetailCache } from "./detail-cache.js";
import {
  activityNotFound,
  apiChanged,
  noActivityFile,
  notLoggedIn,
  rouvyUnavailable,
  workoutNotFound,
} from "./errors.js";
import { createListCache } from "./list-cache.js";
import type { SessionManager } from "./session-manager.js";
import {
  DETAIL_ROUTE,
  LIST_ROUTE,
  parseActivityDetail,
  parseActivityListPage,
  type ActivityDetail,
  type ActivityListRow,
} from "./schemas.js";
import { asRedirect, decodeSingleFetch } from "./turbo-stream.js";
import { createWorkoutListCache } from "./workout-list-cache.js";
import {
  parseDefaultRouteId,
  parseWorkoutDetail,
  parseWorkoutList,
  WORKOUT_CREATOR_ROUTE,
  WORKOUT_DETAIL_ROUTE,
  WORKOUT_LIST_ROUTE,
  type WorkoutDetail,
  type WorkoutList,
} from "./workout-schemas.js";


/** Rouvy's Activity list comes in pages of this many rows. */
export const LIST_PAGE_SIZE = 10;

/** Reads from Rouvy's web app. Read-only by construction: it has no method that writes to Rouvy. */
export interface RouvyClient {
  listActivitiesPage(offset: number): Promise<ActivityListRow[]>;
  getActivity(activityId: string): Promise<ActivityDetail>;
  getActivityFile(activityId: string): Promise<DownloadedActivityFile>;
  /** The rider's `created` collection, newest first. Cached for 60 s. */
  listWorkouts(): Promise<WorkoutList>;
  /** One Workout, read fresh, only if it's the rider's own (spec-m3 §6.3); otherwise *Workout not found*. */
  getOwnedWorkout(workoutId: string): Promise<WorkoutDetail>;
  /** The route Rouvy's creator pre-fills for a new Workout. Never cached: it's a write's first GET. */
  getDefaultRouteId(): Promise<string>;
  /** Forgets the cached `created` list, after a write that succeeded or whose outcome is unknown. */
  dropWorkoutList(): Promise<void>;
}

/** A parsed Activity file, with its bytes as downloaded so an export never costs a second request. */
export interface DownloadedActivityFile extends ActivityFile {
  bytes: Uint8Array;
}

export function createRouvyClient(fetch: typeof globalThis.fetch, sessions: SessionManager, clock: Clock): RouvyClient {
  const listCache = createListCache(clock);
  const detailCache = createDetailCache(clock);
  const activityFileCache = createActivityFileCache();
  const workoutListCache = createWorkoutListCache(clock);

  async function getData(
    route: string,
    path: string,
    {
      params = () => ({}),
      onNotFound,
    }: { params?: (uid: string) => Record<string, string>; onNotFound?: () => Error } = {},
  ) {
    let renewed = false;
    let followedRedirect = false;
    for (;;) {
      const session = await sessions.current();
      const url = new URL(path, RIDERS);
      for (const [key, value] of Object.entries(params(session.uid))) url.searchParams.set(key, value);
      const response = await fetch(url, { headers: { cookie: session.cookieHeader() }, redirect: "manual" });
      session.keepCookies(response.headers.getSetCookie());
      if (response.status === 404 && onNotFound) throw onNotFound();
      // Single-fetch answers 200 with data, or 202 with a redirect. Anything else is an error page.
      if (response.status !== 200 && response.status !== 202) throw rouvyUnavailable(response.status);
      let payload: unknown;
      try {
        payload = await decodeSingleFetch(response.body ?? new Blob([]).stream());
      } catch {
        throw apiChanged(route, "a turbo-stream v2 payload (decoding failed)");
      }

      const redirect = asRedirect(payload);
      if (!redirect) return payload;
      const target = new URL(redirect.redirect, RIDERS);
      if (target.host === "account.rouvy.com" && target.pathname.startsWith("/sign-in")) {
        // Logged out: renew once and retry once. The new Session gets a new cookie jar.
        // Logged out again with a fresh Session: Rouvy refusing, not the rider's login dying.
        if (renewed) throw notLoggedIn({ terminal: false });
        renewed = true;
        followedRedirect = false;
        sessions.invalidate();
      } else if (target.host === url.host && target.pathname === url.pathname.replace(/\.data$/, "")) {
        // A fresh Session's first call sets Rouvy's own cookies (e.g. rouvysession_tos) and
        // redirects back to the same page; the browser simply retries with them.
        if (followedRedirect) throw apiChanged(route, "a data payload (it keeps redirecting)");
        followedRedirect = true;
      } else {
        throw apiChanged(route, "a data payload (it redirects elsewhere)");
      }
    }
  }

  async function getActivity(activityId: string): Promise<ActivityDetail> {
    const uid = await sessions.uid();
    const cached = detailCache.get(uid, activityId);
    if (cached) return cached;
    const payload = await getData(DETAIL_ROUTE, `/activity/${encodeURIComponent(activityId)}.data`, {
      onNotFound: activityNotFound,
    });
    const detail = parseActivityDetail(payload);
    detailCache.set(uid, activityId, detail);
    return detail;
  }

  async function listWorkouts(): Promise<WorkoutList> {
    const uid = await sessions.uid();
    const cached = workoutListCache.get(uid);
    if (cached) return cached;
    const payload = await getData(WORKOUT_LIST_ROUTE, "/workouts/collections/created.data", {
      params: () => ({ _routes: WORKOUT_LIST_ROUTE }),
    });
    const list = parseWorkoutList(payload);
    workoutListCache.set(uid, list);
    return list;
  }

  return {
    getActivity,
    listWorkouts,
    async getOwnedWorkout(workoutId) {
      // Listed in `created` (so neither deleted nor someone else's)…
      const { workouts } = await listWorkouts();
      if (!workouts.some((w) => w.id === workoutId)) throw workoutNotFound();
      const payload = await getData(WORKOUT_DETAIL_ROUTE, `/workouts/${encodeURIComponent(workoutId)}.data`, {
        params: () => ({ _routes: WORKOUT_DETAIL_ROUTE }),
        onNotFound: workoutNotFound,
      });
      const workout = parseWorkoutDetail(payload);
      // …and created by this rider. Rouvy's own `canEdit` is true on catalogue Workouts too.
      if (workout.createdBy.firebaseUid !== (await sessions.uid())) throw workoutNotFound();
      return workout;
    },
    async getDefaultRouteId() {
      const payload = await getData(WORKOUT_CREATOR_ROUTE, "/workouts/create.data", {
        params: () => ({ _routes: WORKOUT_CREATOR_ROUTE }),
      });
      return parseDefaultRouteId(payload);
    },
    async dropWorkoutList() {
      workoutListCache.drop(await sessions.uid());
    },
    async getActivityFile(activityId) {
      const uid = await sessions.uid();
      const cached = activityFileCache.get(uid, activityId);
      if (cached) return cached;
      const { exportLink } = await getActivity(activityId);
      if (!exportLink) throw noActivityFile();
      // A capability URL, the one the web app's Export button uses: no cookies, and never shown.
      const response = await fetch(exportLink);
      if (response.status === 403 || response.status === 404) throw noActivityFile();
      if (response.status !== 200) throw rouvyUnavailable(response.status);
      const bytes = await response.arrayBuffer();
      const file = { ...(await parseActivityFile(bytes)), bytes: new Uint8Array(bytes) };
      activityFileCache.set(uid, activityId, file);
      return file;
    },
    async listActivitiesPage(offset) {
      // The cache key comes from the stored Credentials so a hit costs no request, not even a renewal.
      // The Session is renewed whenever the stored uid changes, so both uids agree.
      const uid = await sessions.uid();
      const cached = listCache.get(uid, offset);
      if (cached) return cached;
      const payload = await getData(LIST_ROUTE, "/resources/activities-pagination.data", {
        params: (sessionUid) => ({ offset: String(offset), firebaseUid: sessionUid, _routes: LIST_ROUTE }),
      });
      const rows = parseActivityListPage(payload);
      listCache.set(uid, offset, rows);
      return rows;
    },
  };
}
