import type { Clock } from "./clock.js";
import { createDetailCache } from "./detail-cache.js";
import { activityNotFound, apiChanged, notLoggedIn, rouvyUnavailable } from "./errors.js";
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

const RIDERS = "https://riders.rouvy.com";

/** Rouvy's Activity list comes in pages of this many rows. */
export const LIST_PAGE_SIZE = 10;

/** Reads from Rouvy's web app. Read-only by construction: it has no method that writes to Rouvy. */
export interface RouvyClient {
  listActivitiesPage(offset: number): Promise<ActivityListRow[]>;
  getActivity(activityId: string): Promise<ActivityDetail>;
}

export function createRouvyClient(fetch: typeof globalThis.fetch, sessions: SessionManager, clock: Clock): RouvyClient {
  const listCache = createListCache(clock);
  const detailCache = createDetailCache(clock);

  async function getData(
    route: string,
    path: string,
    params: (uid: string) => Record<string, string> = () => ({}),
    onNotFound?: () => Error,
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
        if (renewed) throw notLoggedIn();
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

  return {
    async listActivitiesPage(offset) {
      // The cache key comes from the stored Credentials so a hit costs no request, not even a renewal.
      // The Session is renewed whenever the stored uid changes, so both uids agree.
      const uid = await sessions.uid();
      const cached = listCache.get(uid, offset);
      if (cached) return cached;
      const payload = await getData(LIST_ROUTE, "/resources/activities-pagination.data", (sessionUid) => ({
        offset: String(offset),
        firebaseUid: sessionUid,
        _routes: LIST_ROUTE,
      }));
      const rows = parseActivityListPage(payload);
      listCache.set(uid, offset, rows);
      return rows;
    },
    async getActivity(activityId) {
      const uid = await sessions.uid();
      const cached = detailCache.get(uid, activityId);
      if (cached) return cached;
      const payload = await getData(DETAIL_ROUTE, `/activity/${encodeURIComponent(activityId)}.data`, undefined, activityNotFound);
      const detail = parseActivityDetail(payload);
      detailCache.set(uid, activityId, detail);
      return detail;
    },
  };
}
