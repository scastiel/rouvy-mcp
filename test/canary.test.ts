import { describe, expect, it } from "vitest";
import { ROUVY_FIREBASE_WEB_KEY } from "../src/constants.js";
import { BOGUS_ACTIVITY_ID, runCanary } from "./drift/canary.js";
import { fakeNetwork, firebaseError } from "./fakes.js";

/** Rouvy's anonymous answer to any `.data` read, as captured on 2026-10-25. */
function signInRedirect(path: string): Response {
  const redirect = `https://account.rouvy.com/sign-in?riders=true&redirectTo=${encodeURIComponent(path)}`;
  return new Response(
    `[["SingleFetchRedirect",1],{"_2":3,"_4":5,"_6":7,"_8":7,"_9":7},"redirect","${redirect}","status",302,"revalidate",false,"reload","replace"]`,
    { status: 202, headers: { "content-type": "text/x-script" } },
  );
}

function signInPage(key = ROUVY_FIREBASE_WEB_KEY): Response {
  return new Response(`<!DOCTYPE html><html><script>window.ENV={"FIREBASE_API_KEY":"${key}"}</script></html>`, {
    status: 200,
    headers: { "content-type": "text/html" },
  });
}

/** Rouvy and Firebase as they answer today. Override a route to simulate drift. */
function rouvyToday(overrides: Parameters<typeof fakeNetwork>[0] = {}) {
  return fakeNetwork({
    "riders.rouvy.com/resources/activities-pagination.data": () => signInRedirect("/resources/activities-pagination"),
    [`riders.rouvy.com/activity/${BOGUS_ACTIVITY_ID}.data`]: () => signInRedirect(`/activity/${BOGUS_ACTIVITY_ID}`),
    "identitytoolkit.googleapis.com/v1/accounts:signInWithPassword": () => firebaseError("INVALID_LOGIN_CREDENTIALS"),
    "account.rouvy.com/sign-in": () => signInPage(),
    ...overrides,
  });
}

describe("the daily canary", () => {
  it("passes every check against today's Rouvy, with GETs only to Rouvy and the honest user agent", async () => {
    const network = rouvyToday();

    const checks = await runCanary(network.fetch);

    expect(checks).toHaveLength(4);
    expect(checks.filter((check) => !check.ok)).toEqual([]);
    const toRouvy = network.requests.filter((r) => r.url.host.endsWith("rouvy.com"));
    expect(toRouvy).toHaveLength(3);
    expect(toRouvy.every((r) => r.method === "GET" && r.headers.get("cookie") === null)).toBe(true);
    expect(network.requests.every((r) => r.headers.get("user-agent")?.startsWith("rouvy-mcp/"))).toBe(true);
  });

  it("blames the user-agent rule when Cloudflare answers 403 with its HTML page", async () => {
    const network = rouvyToday({
      "riders.rouvy.com/resources/activities-pagination.data": () =>
        new Response("<!DOCTYPE html><title>Attention Required! | Cloudflare</title>", {
          status: 403,
          headers: { "content-type": "text/html" },
        }),
    });

    const [list, ...others] = await runCanary(network.fetch);

    expect(list).toMatchObject({ ok: false, detail: expect.stringMatching(/Cloudflare.*user-agent rule/) });
    expect(others.every((check) => check.ok)).toBe(true);
  });

  it("says the encoding changed when the answer no longer decodes as turbo-stream v2", async () => {
    const network = rouvyToday({
      [`riders.rouvy.com/activity/${BOGUS_ACTIVITY_ID}.data`]: () =>
        new Response('{"redirect":"https://account.rouvy.com/sign-in"}', { status: 202 }),
    });

    const [, activityDetail] = await runCanary(network.fetch);

    expect(activityDetail).toMatchObject({ ok: false, detail: expect.stringMatching(/turbo-stream v2.*encoding changed/) });
  });

  it("fails when an anonymous read is no longer sent to sign-in", async () => {
    const network = rouvyToday({
      "riders.rouvy.com/resources/activities-pagination.data": () =>
        new Response('[{"_1":2},"activities",[]]', { status: 200 }),
    });

    const [list] = await runCanary(network.fetch);

    expect(list).toMatchObject({ ok: false, detail: expect.stringMatching(/HTTP 200.*no redirect to sign-in/) });
  });

  it("fails when Firebase no longer accepts the pinned key", async () => {
    const network = rouvyToday({
      "identitytoolkit.googleapis.com/v1/accounts:signInWithPassword": () =>
        firebaseError("API key not valid. Please pass a valid API key."),
    });

    const [, , firebase] = await runCanary(network.fetch);

    expect(firebase).toMatchObject({ ok: false });
    expect(firebase?.detail).toMatch(/API key not valid/);
  });

  it("fails when the sign-in page no longer carries the pinned key", async () => {
    const network = rouvyToday({ "account.rouvy.com/sign-in": () => signInPage("AIzaSyNEWKEYNEWKEYNEWKEYNEWKEYNEWKEY00") });

    const [, , , page] = await runCanary(network.fetch);

    expect(page).toMatchObject({ ok: false, detail: expect.stringMatching(/key not found/) });
  });

  it("fails only the check whose request didn't go through, and still runs the others", async () => {
    const network = rouvyToday({
      "account.rouvy.com/sign-in": () => {
        throw new TypeError("fetch failed");
      },
    });

    const checks = await runCanary(network.fetch);

    expect(checks.map((check) => check.ok)).toEqual([true, true, true, false]);
    expect(checks[3]?.detail).toMatch(/fetch failed/);
  });
});
