import { describe, expect, it } from "vitest";
import {
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
} from "./server-harness.js";

/** Cloudflare's block page, with a marker that must never reach the rider. */
function cloudflareBlock(): Response {
  return new Response(
    "<!DOCTYPE html><html><head><title>Attention Required! | Cloudflare</title></head><body>SECRET-BODY ray 8f1</body></html>",
    { status: 403, headers: { "content-type": "text/html; charset=UTF-8" } },
  );
}

function listOk(): Response {
  return new Response(fixturePage0(), { headers: { "content-type": "text/x-script" } });
}

/** A logged-in rider whose list route answers with whatever `list` returns next. */
async function riderWithList(list: (attempt: number) => Response | Promise<Response>) {
  const clock = fakeClock();
  const credentials = memoryCredentials({ refreshToken: "refresh-for-uid-1", uid: "uid-1" });
  const listTimes: number[] = [];
  const network = fakeNetwork({
    [REFRESH]: refreshes(clock),
    [AUTH_DATA]: rouvySessionOpened,
    [LIST]: () => list(listTimes.push(clock.now()) - 1),
  });
  const client = await connect({ credentials: credentials.provider, fetch: network.fetch, clock });
  const listActivities = (offset = 0) => client.callTool({ name: "list_activities", arguments: { offset } });
  const listRequests = () => network.requests.filter((r) => r.url.pathname.endsWith("activities-pagination.data"));
  return { clock, network, listActivities, listRequests, listTimes };
}

describe("Rouvy pushing back", () => {
  it("a Cloudflare block starts a 15-minute cool-down during which nothing is sent", async () => {
    const rider = await riderWithList((attempt) => (attempt === 0 ? cloudflareBlock() : listOk()));

    const blocked = await rider.listActivities();

    expect(blocked.isError).toBe(true);
    expect(text(blocked)).toMatch(/blocked by Rouvy's bot protection/);
    // The fake clock starts at 08:00 UTC.
    expect(text(blocked)).toMatch(/try again after 08:15 UTC/i);
    expect(text(blocked)).not.toMatch(/SECRET-BODY|Attention Required/);
    expect(rider.listRequests()).toHaveLength(1);

    // During the cool-down: fails at once, and no request at all goes out, to any host.
    const sentBefore = rider.network.requests.length;
    rider.clock.advance(14 * 60_000);
    const stillBlocked = await rider.listActivities(10);
    expect(stillBlocked.isError).toBe(true);
    expect(text(stillBlocked)).toMatch(/blocked by Rouvy's bot protection/);
    expect(rider.network.requests).toHaveLength(sentBefore);

    // Never retried: once the 15 minutes are up, the next call goes out again.
    rider.clock.advance(60_000);
    const after = await rider.listActivities(10);
    expect(after.isError).toBeFalsy();
    expect(rider.listRequests()).toHaveLength(2);
  });

  it.each([
    { retryAfter: "120", coolDownSec: 120 },
    { retryAfter: undefined, coolDownSec: 60 },
    { retryAfter: "7200", coolDownSec: 900 },
  ])("a 429 with Retry-After $retryAfter cools down for $coolDownSec s, without retrying", async ({ retryAfter, coolDownSec }) => {
    const rider = await riderWithList((attempt) =>
      attempt === 0
        ? new Response("SECRET-BODY", { status: 429, headers: retryAfter ? { "retry-after": retryAfter } : {} })
        : listOk(),
    );

    const limited = await rider.listActivities();

    expect(limited.isError).toBe(true);
    expect(text(limited)).toMatch(new RegExp(`rate limited.*try again in ${coolDownSec} s`, "i"));
    expect(text(limited)).not.toMatch(/SECRET-BODY/);
    expect(rider.listRequests()).toHaveLength(1);

    const sentBefore = rider.network.requests.length;
    rider.clock.advance((coolDownSec - 10) * 1000);
    const stillLimited = await rider.listActivities(10);
    expect(text(stillLimited)).toMatch(/rate limited.*try again in 10 s/i);
    expect(rider.network.requests).toHaveLength(sentBefore);

    rider.clock.advance(10_000);
    expect((await rider.listActivities(10)).isError).toBeFalsy();
  });

  const serverError = () => new Response("SECRET-BODY", { status: 503 });
  const networkError = (): Response => {
    throw new TypeError("fetch failed SECRET-BODY");
  };

  it.each([
    { kind: "a 5xx", fail: serverError },
    { kind: "a network error", fail: networkError },
  ])("$kind on a GET is retried once, 2 s later", async ({ fail }) => {
    const rider = await riderWithList((attempt) => (attempt === 0 ? fail() : listOk()));

    const result = await rider.listActivities();

    expect(result.isError).toBeFalsy();
    const [first, retry] = rider.listTimes;
    expect(rider.listTimes).toHaveLength(2);
    expect(retry! - first!).toBeGreaterThanOrEqual(2_000);
  });

  it.each([
    { kind: "a 5xx", fail: serverError, status: /HTTP 503/ },
    { kind: "a network error", fail: networkError, status: /^(?!.*HTTP)/ },
  ])("$kind twice on a GET means Rouvy is unavailable, with no cool-down", async ({ fail, status }) => {
    const rider = await riderWithList((attempt) => (attempt < 2 ? fail() : listOk()));

    const unavailable = await rider.listActivities();

    expect(unavailable.isError).toBe(true);
    expect(text(unavailable)).toMatch(/Rouvy is unavailable.*try later/i);
    expect(text(unavailable)).toMatch(status);
    expect(text(unavailable)).not.toMatch(/SECRET-BODY|fetch failed/);
    expect(rider.listRequests()).toHaveLength(2);

    // No cool-down: the very next call goes out.
    expect((await rider.listActivities()).isError).toBeFalsy();
    expect(rider.listRequests()).toHaveLength(3);
  });

  it("a 5xx on a POST (the Session refresh) is not retried", async () => {
    const clock = fakeClock();
    const credentials = memoryCredentials({ refreshToken: "refresh-for-uid-1", uid: "uid-1" });
    const network = fakeNetwork({ [REFRESH]: serverError, [AUTH_DATA]: rouvySessionOpened, [LIST]: listOk });
    const client = await connect({ credentials: credentials.provider, fetch: network.fetch, clock });

    const result = await client.callTool({ name: "list_activities", arguments: {} });

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/Rouvy is unavailable.*HTTP 503/i);
    expect(network.requests.map((r) => r.url.host)).toEqual(["securetoken.googleapis.com"]);
  });
});
