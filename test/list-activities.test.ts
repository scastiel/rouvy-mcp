import { describe, expect, it } from "vitest";
import { decode } from "turbo-stream";
import { firebaseError } from "./fakes.js";
import {
  activityRow,
  listPage,
  loggedOut,
  AUTH_DATA,
  connect,
  fakeClock,
  fakeNetwork,
  fixturePage0,
  LIST,
  memoryCredentials,
  REFRESH,
  refreshes,
  rouvySessionOpened,
  text,
  turboStream,
} from "./server-harness.js";

function loggedInRider(clock = fakeClock(), uid = "uid-1") {
  return { clock, credentials: memoryCredentials({ refreshToken: `refresh-for-${uid}`, uid }) };
}

describe("list_activities", () => {
  it("returns the rider's newest Activities as compact rows", async () => {
    const { clock, credentials } = loggedInRider();
    const network = fakeNetwork({
      [REFRESH]: refreshes(clock),
      [AUTH_DATA]: rouvySessionOpened,
      [LIST]: () => new Response(fixturePage0(), { headers: { "content-type": "text/x-script" } }),
    });
    const client = await connect({ credentials: credentials.provider, fetch: network.fetch, clock });

    const result = await client.callTool({ name: "list_activities", arguments: { limit: 2 } });

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result))).toEqual({
      activities: [
        {
          id: "260515171421-fixture0",
          title: "Fixture route 1",
          type: "ROUTE",
          start: "2026-05-15T17:14:21.130Z",
          moving_time_sec: 1956,
          distance_m: 12400,
          elevation_m: 231,
          tss: 55,
          if: 1.01,
        },
        {
          id: "260514155221-fixture1",
          title: "Fixture route 2",
          type: "WORKOUT_FTP_TEST",
          start: "2026-05-14T15:52:21.513Z",
          moving_time_sec: 1987,
          distance_m: 8306,
          elevation_m: 217,
          tss: 52,
          if: 0.97,
        },
      ],
      has_more: true,
    });
    const listRequest = network.requests.find((r) => r.url.pathname.endsWith("activities-pagination.data"));
    expect(listRequest?.url.searchParams.get("offset")).toBe("0");
    expect(listRequest?.url.searchParams.get("firebaseUid")).toBe("uid-1");
    expect(listRequest?.url.searchParams.get("_routes")).toBe("routes/resources.activities-pagination");
    expect(listRequest?.headers.get("cookie")).toContain("rouvy_session=c2Vzc2lvbg");
    expect(listRequest?.headers.get("user-agent")).toMatch(/^rouvy-mcp\//);
  });
});

describe("list_activities paging", () => {
  /** A rider with `count` Activities: ids a00 (newest) … a<count-1>. */
  function riderWithActivities(count: number) {
    const { clock, credentials } = loggedInRider();
    const ids = Array.from({ length: count }, (_, i) => `a${String(i).padStart(2, "0")}`);
    const network = fakeNetwork({
      [REFRESH]: refreshes(clock),
      [AUTH_DATA]: rouvySessionOpened,
      [LIST]: (request) => {
        const offset = Number(request.url.searchParams.get("offset"));
        return listPage(ids.slice(offset, offset + 10).map((id) => activityRow(id)), offset);
      },
    });
    const listOffsets = () =>
      network.requests.filter((r) => r.url.host === "riders.rouvy.com").map((r) => r.url.searchParams.get("offset"));
    return { clock, credentials, network, listOffsets };
  }

  it("stitches a window across upstream pages of 10", async () => {
    const rider = riderWithActivities(25);
    const client = await connect({ credentials: rider.credentials.provider, fetch: rider.network.fetch, clock: rider.clock });

    const result = await client.callTool({ name: "list_activities", arguments: { offset: 8, limit: 5 } });

    const body = JSON.parse(text(result));
    expect(body.activities.map((a: { id: string }) => a.id)).toEqual(["a08", "a09", "a10", "a11", "a12"]);
    expect(body.has_more).toBe(true);
    expect(rider.listOffsets()).toEqual(["0", "10"]);
  });

  it("stops at the first empty page and says nothing more exists", async () => {
    const rider = riderWithActivities(20);
    const client = await connect({ credentials: rider.credentials.provider, fetch: rider.network.fetch, clock: rider.clock });

    const result = await client.callTool({ name: "list_activities", arguments: { offset: 15, limit: 50 } });

    const body = JSON.parse(text(result));
    expect(body.activities.map((a: { id: string }) => a.id)).toEqual(["a15", "a16", "a17", "a18", "a19"]);
    expect(body.has_more).toBe(false);
    expect(rider.listOffsets()).toEqual(["10", "20"]);
  });

  it("fetches at most 6 upstream pages for the widest window", async () => {
    const rider = riderWithActivities(200);
    const client = await connect({ credentials: rider.credentials.provider, fetch: rider.network.fetch, clock: rider.clock });

    const result = await client.callTool({ name: "list_activities", arguments: { offset: 5, limit: 50 } });

    expect(JSON.parse(text(result)).activities).toHaveLength(50);
    expect(rider.listOffsets()).toEqual(["0", "10", "20", "30", "40", "50"]);
  });

  it("rejects a limit above 50", async () => {
    const rider = riderWithActivities(5);
    const client = await connect({ credentials: rider.credentials.provider, fetch: rider.network.fetch, clock: rider.clock });

    const result = await client.callTool({ name: "list_activities", arguments: { limit: 51 } });

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/limit/);
    expect(rider.network.requests).toHaveLength(0);
  });
});

describe("list_activities keeps the Session alive", () => {
  const page = () => listPage([activityRow("a00")]);
  const countRefreshes = (requests: { url: URL }[]) => requests.filter((r) => r.url.host === "securetoken.googleapis.com").length;

  it("renews a Session whose idToken is about to expire, before calling Rouvy", async () => {
    const { clock, credentials } = loggedInRider();
    const network = fakeNetwork({ [REFRESH]: refreshes(clock), [AUTH_DATA]: rouvySessionOpened, [LIST]: page });
    const client = await connect({ credentials: credentials.provider, fetch: network.fetch, clock });
    await client.callTool({ name: "list_activities", arguments: {} });
    expect(countRefreshes(network.requests)).toBe(1);

    clock.advance(56 * 60_000); // idToken lives 1 h; within ~5 min of exp it gets renewed
    await client.callTool({ name: "list_activities", arguments: { offset: 10 } });

    expect(countRefreshes(network.requests)).toBe(2);
  });

  it("renews once and retries once when Rouvy says the Session is logged out", async () => {
    const { clock, credentials } = loggedInRider();
    let listCalls = 0;
    const network = fakeNetwork({
      [REFRESH]: refreshes(clock),
      [AUTH_DATA]: rouvySessionOpened,
      [LIST]: () => (++listCalls === 1 ? loggedOut() : page()),
    });
    const client = await connect({ credentials: credentials.provider, fetch: network.fetch, clock });

    const result = await client.callTool({ name: "list_activities", arguments: {} });

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result)).activities).toHaveLength(1);
    expect(countRefreshes(network.requests)).toBe(2);
    expect(listCalls).toBe(2);
  });

  it("gives up with 'not logged in' when the retry is logged out too", async () => {
    const { clock, credentials } = loggedInRider();
    const network = fakeNetwork({ [REFRESH]: refreshes(clock), [AUTH_DATA]: rouvySessionOpened, [LIST]: loggedOut });
    const client = await connect({ credentials: credentials.provider, fetch: network.fetch, clock });

    const result = await client.callTool({ name: "list_activities", arguments: {} });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Not logged in to Rouvy");
    expect(network.requests.filter((r) => r.url.host === "riders.rouvy.com")).toHaveLength(2);
  });

  it("says 'not logged in' when the refresh token no longer works", async () => {
    const { clock, credentials } = loggedInRider();
    const network = fakeNetwork({ [REFRESH]: () => firebaseError("TOKEN_EXPIRED") });
    const client = await connect({ credentials: credentials.provider, fetch: network.fetch, clock });

    const result = await client.callTool({ name: "list_activities", arguments: {} });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Not logged in to Rouvy");
  });
});

describe("list_activities and Rouvy's own cookies", () => {
  /** What riders.rouvy.com really answers to a fresh Session's first `.data` call. */
  function setsCookiesAndRedirectsToItself(): Response {
    return new Response(
      '[["SingleFetchRedirect",1],{"_2":3,"_4":5},"redirect","https://riders.rouvy.com/resources/activities-pagination?offset=0","status",302]',
      {
        status: 202,
        headers: [
          ["content-type", "text/x-script"],
          ["set-cookie", "rouvysession_tos=accepted; Domain=rouvy.com; Path=/; Secure"],
          ["set-cookie", "__cf_bm=cf; Path=/; HttpOnly"],
        ],
      },
    );
  }

  it("keeps the cookies, retries once, and sends them on later calls", async () => {
    const { clock, credentials } = loggedInRider();
    const network = fakeNetwork({
      [REFRESH]: refreshes(clock),
      [AUTH_DATA]: rouvySessionOpened,
      [LIST]: (request) =>
        request.headers.get("cookie")?.includes("rouvysession_tos=accepted")
          ? listPage(Array.from({ length: 10 }, (_, i) => activityRow(`a${i}`)))
          : setsCookiesAndRedirectsToItself(),
    });
    const client = await connect({ credentials: credentials.provider, fetch: network.fetch, clock });

    const first = await client.callTool({ name: "list_activities", arguments: {} });
    await client.callTool({ name: "list_activities", arguments: { offset: 10, limit: 1 } });

    expect(first.isError).toBeFalsy();
    expect(JSON.parse(text(first)).activities).toHaveLength(10);
    const cookies = network.requests.filter((r) => r.url.host === "riders.rouvy.com").map((r) => r.headers.get("cookie"));
    expect(cookies).toHaveLength(3);
    expect(cookies[1]).toContain("rouvy_session=c2Vzc2lvbg");
    expect(cookies[1]).toContain("__cf_bm=cf");
    expect(cookies[2]).toContain("rouvysession_tos=accepted");
  });

  it("handles the cookie redirect again after a renewed Session", async () => {
    const { clock, credentials } = loggedInRider();
    const answers = [setsCookiesAndRedirectsToItself, loggedOut, setsCookiesAndRedirectsToItself];
    const network = fakeNetwork({
      [REFRESH]: refreshes(clock),
      [AUTH_DATA]: rouvySessionOpened,
      [LIST]: () => (answers.shift() ?? (() => listPage([activityRow("a00")])))(),
    });
    const client = await connect({ credentials: credentials.provider, fetch: network.fetch, clock });

    const result = await client.callTool({ name: "list_activities", arguments: {} });

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result)).activities).toHaveLength(1);
  });

  it("treats a redirect to some other page as an API change", async () => {
    const { clock, credentials } = loggedInRider();
    const network = fakeNetwork({
      [REFRESH]: refreshes(clock),
      [AUTH_DATA]: rouvySessionOpened,
      [LIST]: () =>
        new Response('[["SingleFetchRedirect",1],{"_2":3,"_4":5},"redirect","https://riders.rouvy.com/maintenance","status",302]', {
          status: 202,
        }),
    });
    const client = await connect({ credentials: credentials.provider, fetch: network.fetch, clock });

    const result = await client.callTool({ name: "list_activities", arguments: {} });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Rouvy changed its API");
    expect(network.requests.filter((r) => r.url.host === "riders.rouvy.com")).toHaveLength(1);
  });

  it("does not loop when Rouvy keeps redirecting", async () => {
    const { clock, credentials } = loggedInRider();
    const network = fakeNetwork({
      [REFRESH]: refreshes(clock),
      [AUTH_DATA]: rouvySessionOpened,
      [LIST]: setsCookiesAndRedirectsToItself,
    });
    const client = await connect({ credentials: credentials.provider, fetch: network.fetch, clock });

    const result = await client.callTool({ name: "list_activities", arguments: {} });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Rouvy changed its API");
    expect(network.requests.filter((r) => r.url.host === "riders.rouvy.com")).toHaveLength(2);
  });
});

describe("list_activities when Rouvy changes its API", () => {
  async function fixtureWithout(field: "id" | "startUTC") {
    const { value, done } = await decode(new Blob([fixturePage0()]).stream());
    await done;
    const page = structuredClone(value) as Record<string, { data: { activities: Record<string, unknown>[] } }>;
    delete page["routes/resources.activities-pagination"]!.data.activities[2]![field];
    return () => turboStream(page);
  }

  it.each(["id", "startUTC"] as const)("names the route and the missing %s", async (field) => {
    const { clock, credentials } = loggedInRider();
    const network = fakeNetwork({ [REFRESH]: refreshes(clock), [AUTH_DATA]: rouvySessionOpened, [LIST]: await fixtureWithout(field) });
    const client = await connect({ credentials: credentials.provider, fetch: network.fetch, clock });

    const result = await client.callTool({ name: "list_activities", arguments: {} });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Rouvy changed its API");
    expect(text(result)).toContain("routes/resources.activities-pagination");
    expect(text(result)).toContain(`activities[2].${field}`);
  });

  it("leaves out optional numbers Rouvy sends as null or omits, and says so", async () => {
    const { clock, credentials } = loggedInRider();
    const rows = [
      activityRow("a00", { total: { distM: 1000, elevM: 10, movingTimeSec: 600, tss: null, if: null } }),
      activityRow("a01", { title: undefined }),
      activityRow("a02"),
    ];
    const network = fakeNetwork({ [REFRESH]: refreshes(clock), [AUTH_DATA]: rouvySessionOpened, [LIST]: () => listPage(rows) });
    const client = await connect({ credentials: credentials.provider, fetch: network.fetch, clock });

    const result = await client.callTool({ name: "list_activities", arguments: {} });

    expect(result.isError).toBeFalsy();
    const body = JSON.parse(text(result));
    expect(body.activities[0]).not.toHaveProperty("tss");
    expect(body.activities[0]).not.toHaveProperty("if");
    expect(body.activities[0].distance_m).toBe(1000);
    expect(body.activities[1]).not.toHaveProperty("title");
    expect(body.activities[2].tss).toBe(55);
    expect(body.notes).toEqual([
      "Rouvy gave no title for 1 Activity; left out.",
      "Rouvy gave no tss for 1 Activity; left out.",
      "Rouvy gave no if for 1 Activity; left out.",
    ]);
  });

  it("reports an HTTP error page as Rouvy being unavailable, not as an API change", async () => {
    const { clock, credentials } = loggedInRider();
    const network = fakeNetwork({
      [REFRESH]: refreshes(clock),
      [AUTH_DATA]: rouvySessionOpened,
      [LIST]: () => new Response("<html>Bad gateway</html>", { status: 502 }),
    });
    const client = await connect({ credentials: credentials.provider, fetch: network.fetch, clock });

    const result = await client.callTool({ name: "list_activities", arguments: {} });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Rouvy is unavailable");
    expect(text(result)).not.toContain("changed its API");
    expect(text(result)).not.toContain("Bad gateway");
  });

  it("treats a body that isn't turbo-stream as an API change, without echoing it", async () => {
    const { clock, credentials } = loggedInRider();
    const network = fakeNetwork({
      [REFRESH]: refreshes(clock),
      [AUTH_DATA]: rouvySessionOpened,
      [LIST]: () => new Response("<html>something new, secret-ish</html>", { status: 200 }),
    });
    const client = await connect({ credentials: credentials.provider, fetch: network.fetch, clock });

    const result = await client.callTool({ name: "list_activities", arguments: {} });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Rouvy changed its API");
    expect(text(result)).toContain("routes/resources.activities-pagination");
    expect(text(result)).not.toContain("secret-ish");
  });
});

describe("list_activities cache", () => {
  /** Each rider's list is keyed by the `firebaseUid` query param, like Rouvy's. */
  function riders(lists: Record<string, string[]>, clock = fakeClock()) {
    const network = fakeNetwork({
      [REFRESH]: refreshes(clock),
      [AUTH_DATA]: rouvySessionOpened,
      [LIST]: (request) => {
        const ids = lists[request.url.searchParams.get("firebaseUid") ?? ""] ?? [];
        const offset = Number(request.url.searchParams.get("offset"));
        return listPage(ids.slice(offset, offset + 10).map((id) => activityRow(id)), offset);
      },
    });
    const listCalls = () => network.requests.filter((r) => r.url.host === "riders.rouvy.com").length;
    return { clock, network, listCalls };
  }
  const ids = (result: unknown) => JSON.parse(text(result)).activities.map((a: { id: string }) => a.id);
  const range = (prefix: string, from: number, to: number) =>
    Array.from({ length: to - from }, (_, i) => `${prefix}${from + i}`);

  it("serves list pages from memory for 60 s", async () => {
    const { clock, network, listCalls } = riders({ "uid-1": range("a", 0, 5) });
    const credentials = memoryCredentials({ refreshToken: "refresh-for-uid-1", uid: "uid-1" });
    const client = await connect({ credentials: credentials.provider, fetch: network.fetch, clock });

    await client.callTool({ name: "list_activities", arguments: {} });
    clock.advance(59_000);
    await client.callTool({ name: "list_activities", arguments: { limit: 3 } });
    expect(listCalls()).toBe(1);

    clock.advance(2_000);
    await client.callTool({ name: "list_activities", arguments: {} });
    expect(listCalls()).toBe(2);
  });

  it("never serves the previous account's Activities after logging in as someone else", async () => {
    const { clock, network } = riders({ "uid-1": ["mine-1", "mine-2"], "uid-2": ["theirs-1"] });
    const credentials = memoryCredentials({ refreshToken: "refresh-for-uid-1", uid: "uid-1" });
    const client = await connect({ credentials: credentials.provider, fetch: network.fetch, clock });
    expect(ids(await client.callTool({ name: "list_activities", arguments: {} }))).toEqual(["mine-1", "mine-2"]);

    credentials.set({ refreshToken: "refresh-for-uid-2", uid: "uid-2" });

    expect(ids(await client.callTool({ name: "list_activities", arguments: {} }))).toEqual(["theirs-1"]);
  });

  it("drops every cached page when a new Activity shifts the list", async () => {
    const lists = { "uid-1": range("a", 0, 20) };
    const { clock, network } = riders(lists);
    const credentials = memoryCredentials({ refreshToken: "refresh-for-uid-1", uid: "uid-1" });
    const client = await connect({ credentials: credentials.provider, fetch: network.fetch, clock });
    await client.callTool({ name: "list_activities", arguments: { limit: 10 } }); // page 0 cached at t0
    clock.advance(30_000);
    await client.callTool({ name: "list_activities", arguments: { offset: 10, limit: 10 } }); // page 10 cached at t0+30s

    lists["uid-1"] = ["new-activity", ...range("a", 0, 20)];
    clock.advance(31_000); // page 0 expired, page 10 still fresh
    await client.callTool({ name: "list_activities", arguments: { limit: 1 } });

    const result = await client.callTool({ name: "list_activities", arguments: { offset: 10, limit: 1 } });
    expect(ids(result)).toEqual(["a9"]);
  });
});

describe("list_activities politeness", () => {
  it("spaces every request it makes, auth included, at least 1 s apart", async () => {
    const { clock, credentials } = loggedInRider();
    const network = fakeNetwork({
      [REFRESH]: refreshes(clock),
      [AUTH_DATA]: rouvySessionOpened,
      [LIST]: (request) => {
        const offset = Number(request.url.searchParams.get("offset"));
        return listPage(Array.from({ length: 10 }, (_, i) => activityRow(`a${offset + i}`)), offset);
      },
    });
    const startTimes: number[] = [];
    const timedFetch: typeof globalThis.fetch = (input, init) => {
      startTimes.push(clock.now());
      return network.fetch(input, init);
    };
    const client = await connect({ credentials: credentials.provider, fetch: timedFetch, clock });

    await client.callTool({ name: "list_activities", arguments: { limit: 25 } });

    expect(startTimes).toHaveLength(5); // refresh, auth.data, 3 list pages
    for (let i = 1; i < startTimes.length; i++) {
      expect(startTimes[i]! - startTimes[i - 1]!).toBeGreaterThanOrEqual(1_000);
    }
  });
});

describe("list_activities without credentials", () => {
  it("is still listed, and says how to log in when called", async () => {
    const clock = fakeClock();
    const network = fakeNetwork({});
    const client = await connect({ credentials: memoryCredentials().provider, fetch: network.fetch, clock });

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("list_activities");

    const result = await client.callTool({ name: "list_activities", arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Not logged in to Rouvy");
    expect(text(result)).toContain("npx -y rouvy-mcp login");
    expect(network.requests).toHaveLength(0);
  });

  it("works as soon as the rider logs in from a terminal, without a restart", async () => {
    const clock = fakeClock();
    const credentials = memoryCredentials();
    const network = fakeNetwork({ [REFRESH]: refreshes(clock), [AUTH_DATA]: rouvySessionOpened, [LIST]: () => listPage([activityRow("a00")]) });
    const client = await connect({ credentials: credentials.provider, fetch: network.fetch, clock });
    expect((await client.callTool({ name: "list_activities", arguments: {} })).isError).toBe(true);

    credentials.set({ refreshToken: "refresh-for-uid-1", uid: "uid-1" });

    const result = await client.callTool({ name: "list_activities", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result)).activities).toHaveLength(1);
  });
});
