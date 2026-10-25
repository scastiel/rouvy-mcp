import { describe, expect, it } from "vitest";
import type { LogEvent } from "../../src/hosted/log.js";
import { canaryRoutes, firebaseError, json } from "../fakes.js";
import { activityRow, AUTH_DATA, detail, fakeIdToken, LIST, listPage, REFRESH, ROUTE_ACTIVITY } from "../server-harness.js";
import {
  CLIENT_IP,
  CONSENTED,
  connect,
  hostedWorker,
  MCP_URL,
  mcpRequest,
  openSignIn,
  registerClient,
  SIGN_IN,
  signedIn,
  submitSignIn,
} from "./harness.js";

const RIDER = "rider@example.com";

/** One allow-listed rider, uid-1, with one Activity. */
type HostedWorker = ReturnType<typeof hostedWorker>;

const listActivities = (worker: HostedWorker, token: string) =>
  mcpRequest(worker, token, "tools/call", { name: "list_activities", arguments: { limit: 1 } });

/** Cloudflare's "Attention Required!" page in front of Rouvy. */
const cloudflareBlock = () =>
  new Response("<!DOCTYPE html><title>Attention Required! | Cloudflare</title>", {
    status: 403,
    headers: { "content-type": "text/html" },
  });

/** Cloudflare's managed challenge in front of Rouvy. */
const cloudflareChallenge = () =>
  new Response("<!DOCTYPE html><title>Just a moment...</title>", {
    status: 403,
    headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
  });

/** Rouvy answering auth.data without opening a Session, though the idToken is fresh. */
const authDataRefused = () => new Response(null, { status: 202 });

function workerWithRider(routes: NonNullable<Parameters<typeof hostedWorker>[0]>["routes"] = {}) {
  return hostedWorker({
    allowList: RIDER,
    routes: { [SIGN_IN]: signedIn("uid-1", RIDER), [LIST]: () => listPage([activityRow("a00")]), ...routes },
  });
}

const HOUR_MS = 60 * 60_000;

/** No rider: Rouvy and Firebase answer the canary's account-free requests as they do today. */
function workerForHealth(routes: NonNullable<Parameters<typeof hostedWorker>[0]>["routes"] = {}) {
  return hostedWorker({ allowList: RIDER, routes: { ...canaryRoutes(), ...routes } });
}

const health = async (worker: HostedWorker) => {
  const response = await worker.fetch("/health");
  return { status: response.status, body: (await response.json()) as Record<string, any> };
};

/** The canary's requests: three to Rouvy, one to Firebase. */
const canaryRequests = (worker: HostedWorker) => worker.network.requests.filter((r) => !r.url.host.startsWith("securetoken"));

/** Every event the hosted server logs (spec-m2 §9). */
const EVENT_TYPES: LogEvent["event"][] = [
  "tool_call",
  "upstream",
  "cool_down",
  "block_signal",
  "grant_created",
  "grant_revoked",
  "refresh_token_rotated",
  "durable_object_started",
  "health_checked",
];

describe("the operations log", () => {
  it("never holds a uid, email, IP address, token, password or props, whatever the event", async () => {
    const worker = hostedWorker({
      allowList: RIDER,
      routes: {
        ...canaryRoutes(),
        [SIGN_IN]: signedIn("uid-1", RIDER),
        [LIST]: () => new Response(null, { status: 429 }),
      },
    });
    worker.network.routes[REFRESH] = () =>
      json({ id_token: fakeIdToken("uid-1", worker.clock.now() + HOUR_MS), refresh_token: "rotated-secret", user_id: "uid-1" });
    // Signs in, rotates the refresh token and gets rate limited, then revokes from the client.
    const first = await connect(worker, RIDER);
    await listActivities(worker, first.accessToken);
    await worker.fetch("/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: first.refreshToken, client_id: first.clientId, resource: MCP_URL }),
    });
    await health(worker);
    // Signs in again, then Firebase ends the login.
    const second = await connect(worker, RIDER);
    worker.clock.advance(2 * HOUR_MS);
    worker.network.routes[REFRESH] = () => firebaseError("INVALID_REFRESH_TOKEN");
    await listActivities(worker, second.accessToken);
    // Rouvy refuses a Session on the sign-in page.
    worker.network.routes[AUTH_DATA] = authDataRefused;
    await submitSignIn(worker, await openSignIn(worker, await registerClient(worker)), {
      email: RIDER,
      password: "correct horse",
      ...CONSENTED,
    });

    expect(new Set(worker.events().map((e) => e.event))).toEqual(new Set(EVENT_TYPES));
    const secrets = [
      "uid-1",
      RIDER,
      CLIENT_IP,
      "correct horse",
      "refresh-for-uid-1",
      "rotated-secret",
      "id-token-uid-1",
      first.accessToken,
      first.refreshToken,
      second.accessToken,
      second.refreshToken,
      "props",
    ];
    for (const line of worker.logs) for (const secret of secrets) expect(line).not.toContain(secret);
  });

  it("records a Grant created when a rider signs in", async () => {
    const worker = workerWithRider();

    await connect(worker, RIDER);

    expect(worker.events()).toContainEqual({ event: "grant_created" });
  });

  it("records a Grant revoked on a terminal error when Firebase ends the rider's login", async () => {
    const worker = workerWithRider();
    const tokens = await connect(worker, RIDER);
    worker.network.routes[REFRESH] = () => firebaseError("INVALID_REFRESH_TOKEN");

    await listActivities(worker, tokens.accessToken);

    expect(worker.events()).toContainEqual({ event: "grant_revoked", reason: "terminal_auth_failure" });
  });

  it("records a Grant revoked when the client revokes its token", async () => {
    const worker = workerWithRider();
    const tokens = await connect(worker, RIDER);

    const response = await worker.fetch("/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: tokens.refreshToken, client_id: tokens.clientId, resource: MCP_URL }),
    });

    expect(response.status).toBe(200);
    expect(worker.events()).toContainEqual({ event: "grant_revoked", reason: "client" });
    expect((await listActivities(worker, tokens.accessToken)).status).toBe(401);
  });

  it("records each tool call with its outcome and duration", async () => {
    const worker = workerWithRider();
    const tokens = await connect(worker, RIDER);

    await listActivities(worker, tokens.accessToken);
    await mcpRequest(worker, tokens.accessToken, "tools/call", { name: "get_activity", arguments: { activity_id: "260503195435-missing0" } });

    const calls = worker.events().filter((e) => e.event === "tool_call");
    expect(calls).toEqual([
      { event: "tool_call", tool: "list_activities", outcome: "ok", duration_ms: expect.any(Number) },
      { event: "tool_call", tool: "get_activity", outcome: "rouvy_error", duration_ms: expect.any(Number) },
    ]);
  });

  it("records a tool call that ended the rider's login as signed out", async () => {
    const worker = workerWithRider();
    const tokens = await connect(worker, RIDER);
    worker.network.routes[REFRESH] = () => firebaseError("INVALID_REFRESH_TOKEN");

    await listActivities(worker, tokens.accessToken);

    expect(worker.events()).toContainEqual(expect.objectContaining({ event: "tool_call", outcome: "signed_out" }));
  });

  it("records the refresh-token rotation counter, never the tokens", async () => {
    const worker = workerWithRider();
    const tokens = await connect(worker, RIDER);
    worker.network.routes[REFRESH] = () =>
      json({ id_token: fakeIdToken("uid-1", worker.clock.now() + 3_600_000), refresh_token: "rotated-1", user_id: "uid-1" });

    await listActivities(worker, tokens.accessToken);

    expect(worker.events()).toContainEqual({ event: "refresh_token_rotated", rotations: 1 });
  });

  it("records the Durable Object starting, which after a deploy means it was evicted", () => {
    const worker = workerWithRider();

    expect(worker.events()).toEqual([{ event: "durable_object_started" }]);
  });

  it("records Rouvy's and Firebase's status codes, from sign-in and from tool calls", async () => {
    const worker = workerWithRider({ [LIST]: () => new Response(null, { status: 404 }) });
    const tokens = await connect(worker, RIDER);

    await listActivities(worker, tokens.accessToken);

    expect(worker.events().filter((e) => e.event === "upstream")).toEqual([
      { event: "upstream", service: "firebase", status: 200 },
      { event: "upstream", service: "rouvy", status: 202 },
      { event: "upstream", service: "firebase", status: 200 },
      { event: "upstream", service: "rouvy", status: 202 },
      { event: "upstream", service: "rouvy", status: 404 },
    ]);
  });

  it("records a cool-down when Rouvy rate limits", async () => {
    const worker = workerWithRider({ [LIST]: () => new Response(null, { status: 429, headers: { "retry-after": "120" } }) });
    const tokens = await connect(worker, RIDER);

    await listActivities(worker, tokens.accessToken);

    expect(worker.events()).toContainEqual({ event: "cool_down", reason: "rate_limited", seconds: 120 });
  });

  it.each([
    ["a Cloudflare 403", cloudflareBlock],
    ["a Cloudflare challenge", cloudflareChallenge],
  ])("records a block signal on %s in front of Rouvy", async (_, block) => {
    const worker = workerWithRider({ [LIST]: block });
    const tokens = await connect(worker, RIDER);

    await listActivities(worker, tokens.accessToken);

    expect(worker.events()).toContainEqual({ event: "block_signal", kind: "cloudflare" });
  });

  it("records a block signal when Rouvy refuses auth.data despite a fresh idToken", async () => {
    const worker = workerWithRider();
    const tokens = await connect(worker, RIDER);
    worker.network.routes[AUTH_DATA] = authDataRefused;

    await listActivities(worker, tokens.accessToken);

    expect(worker.events()).toContainEqual({ event: "block_signal", kind: "auth_data_refused" });
  });

  it("records a block signal when Rouvy refuses auth.data on the sign-in page", async () => {
    const worker = workerWithRider({ [AUTH_DATA]: authDataRefused });
    const signIn = await openSignIn(worker, await registerClient(worker));

    await submitSignIn(worker, signIn, { email: RIDER, password: "correct horse", ...CONSENTED });

    expect(worker.events()).toContainEqual({ event: "block_signal", kind: "auth_data_refused" });
  });

  it("doesn't take Rouvy's own 403, with no Cloudflare page, for a block", async () => {
    const worker = workerWithRider({ [LIST]: () => new Response(null, { status: 403 }) });
    const tokens = await connect(worker, RIDER);

    await listActivities(worker, tokens.accessToken);

    expect(worker.events().filter((e) => e.event === "block_signal")).toEqual([]);
  });
});

describe("GET /health", () => {
  it("runs the account-free canary checks from the Worker's egress and reports them", async () => {
    const worker = workerForHealth();

    const { status, body } = await health(worker);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.checks).toHaveLength(4);
    expect(body.checks.every((check: { ok: boolean }) => check.ok)).toBe(true);
    expect(body.blockSignals).toEqual({ cloudflare: 0, auth_data_refused: 0, persisting: false });
  });

  it("answers from its cache when hit twice within an hour: Rouvy sees one set of requests", async () => {
    const worker = workerForHealth();

    await health(worker);
    worker.clock.advance(HOUR_MS - 1);
    const second = await health(worker);

    expect(second.body.ok).toBe(true);
    expect(canaryRequests(worker)).toHaveLength(4);
    expect(worker.events().filter((e) => e.event === "health_checked")).toEqual([{ event: "health_checked", failing: 0 }]);
  });

  it("runs the checks again once its cache is an hour old", async () => {
    const worker = workerForHealth();

    await health(worker);
    worker.clock.advance(HOUR_MS);
    await health(worker);

    expect(canaryRequests(worker)).toHaveLength(8);
  });

  it("runs the checks once for two hits at the same time", async () => {
    const worker = workerForHealth();

    await Promise.all([health(worker), health(worker)]);

    expect(canaryRequests(worker)).toHaveLength(4);
  });

  it("answers 503 when a check fails", async () => {
    const worker = workerForHealth({
      "riders.rouvy.com/resources/activities-pagination.data": () =>
        new Response("<!DOCTYPE html><title>Attention Required! | Cloudflare</title>", {
          status: 403,
          headers: { "content-type": "text/html" },
        }),
    });

    const { status, body } = await health(worker);

    expect(status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.checks[0]).toMatchObject({ ok: false, detail: expect.stringMatching(/Cloudflare/) });
  });

  it("reports the hard block signals of the last 24 h, from tool calls and the sign-in page", async () => {
    const worker = workerForHealth({ [SIGN_IN]: signedIn("uid-1", RIDER), [detail(ROUTE_ACTIVITY)]: cloudflareBlock });
    const tokens = await connect(worker, RIDER);
    await mcpRequest(worker, tokens.accessToken, "tools/call", { name: "get_activity", arguments: { activity_id: ROUTE_ACTIVITY } });
    worker.network.routes[AUTH_DATA] = authDataRefused;
    const signIn = await openSignIn(worker, await registerClient(worker));
    await submitSignIn(worker, signIn, { email: RIDER, password: "correct horse", ...CONSENTED });

    const { body } = await health(worker);

    expect(body.blockSignals).toEqual({ cloudflare: 1, auth_data_refused: 1, persisting: false });
  });

  it("forgets block signals after 24 h", async () => {
    const worker = workerForHealth({ [AUTH_DATA]: authDataRefused, [SIGN_IN]: signedIn("uid-1", RIDER) });
    const signIn = await openSignIn(worker, await registerClient(worker));
    await submitSignIn(worker, signIn, { email: RIDER, password: "correct horse", ...CONSENTED });

    worker.clock.advance(24 * HOUR_MS);
    const { body } = await health(worker);

    expect(body.blockSignals).toEqual({ cloudflare: 0, auth_data_refused: 0, persisting: false });
  });

  it("fails when hard block signals have persisted for over an hour: that's a block", async () => {
    const worker = workerForHealth({ [AUTH_DATA]: authDataRefused, [SIGN_IN]: signedIn("uid-1", RIDER) });
    for (let attempt = 0; attempt < 2; attempt++) {
      const signIn = await openSignIn(worker, await registerClient(worker));
      await submitSignIn(worker, signIn, { email: RIDER, password: "correct horse", ...CONSENTED });
      worker.clock.advance(HOUR_MS + 1);
    }

    const { status, body } = await health(worker);

    expect(status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.blockSignals).toEqual({ cloudflare: 0, auth_data_refused: 2, persisting: true });
  });
});
