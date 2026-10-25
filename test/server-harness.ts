import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { encode } from "turbo-stream";
import type { Clock } from "../src/rouvy/clock.js";
import type { Credentials, CredentialsProvider } from "../src/credentials/types.js";
import { createServer } from "../src/server.js";
import { fakeNetwork, json, rouvySessionOpened } from "./fakes.js";

export const LIST_ROUTE = "routes/resources.activities-pagination";
export const LIST = "riders.rouvy.com/resources/activities-pagination.data";
export const REFRESH = "securetoken.googleapis.com/v1/token";
export const AUTH_DATA = "account.rouvy.com/resources/auth.data";

/** Page 0 of a real rider's Activity list, redacted (7 Activities, so it's also the last page). */
export const fixturePage0 = () => readFileSync(new URL("./fixtures/activities-page-0.data", import.meta.url), "utf8");

export const DETAIL_ROUTE = "routes/_main.activity.$id";
/** The fake network's key for one Activity's detail payload. */
export const detail = (activityId: string) => `riders.rouvy.com/activity/${activityId}.data`;

/** Real Activity detail payloads, redacted: an Activity on a route (with segment passes), a workout Activity (with laps). */
export const ROUTE_ACTIVITY = "260503195435-fixture0";
export const WORKOUT_ACTIVITY = "260703200246-fixture1";
export const fixtureDetail = (name: "route" | "workout") =>
  readFileSync(new URL(`./fixtures/activity-${name}.data`, import.meta.url), "utf8");

/** Virtual time: sleeping advances it instantly. */
export function fakeClock(start = 1_800_000_000_000): Clock & { advance(ms: number): void } {
  let now = start;
  return {
    now: () => now,
    async sleep(ms) {
      now += Math.max(0, ms);
    },
    advance(ms) {
      now += ms;
    },
  };
}

export function memoryCredentials(initial: Credentials | null = null) {
  let stored = initial;
  const provider: CredentialsProvider = {
    async load() {
      return stored;
    },
    async save(credentials) {
      stored = credentials;
    },
  };
  return { provider, set: (c: Credentials | null) => (stored = c), get: () => stored };
}

/** An unsigned JWT: Rouvy's idTokens are only ever read for their `exp`. */
export function fakeIdToken(uid: string, expMs: number): string {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "none" })}.${part({ user_id: uid, exp: Math.floor(expMs / 1000) })}.sig`;
}

/** securetoken answering for whichever uid the refresh token names (`refresh-for-<uid>`). */
export function refreshes(clock: Clock) {
  return (request: { body: string }) => {
    const refreshToken = new URLSearchParams(request.body).get("refresh_token") ?? "";
    const uid = refreshToken.replace(/^refresh-for-/, "");
    return json({ id_token: fakeIdToken(uid, clock.now() + 3600_000), refresh_token: refreshToken, user_id: uid });
  };
}

export async function turboStream(value: unknown, status = 200): Promise<Response> {
  return new Response(await new Response(encode(value)).text(), { status, headers: { "content-type": "text/x-script" } });
}

export function activityRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `Ride ${id}`,
    training: "ROUTE",
    startUTC: "2026-10-01T12:00:00.000Z",
    total: { distM: 20000, elevM: 150, kCal: 500, movingTimeSec: 3600, longestRide: 0, tss: 55, if: 0.7 },
    ...overrides,
  };
}

export function listPage(rows: unknown[], offset = 0) {
  return turboStream({ [LIST_ROUTE]: { data: { activities: rows, offset, error: null } } });
}

/** Rouvy's logged-out answer, in its real flattened turbo-stream form. */
export function loggedOut(): Response {
  return new Response(
    '[["SingleFetchRedirect",1],{"_2":3,"_4":5},"redirect","https://account.rouvy.com/sign-in?riders=true&redirectTo=%2Fresources%2Factivities-pagination","status",302]',
    { status: 202, headers: { "content-type": "text/x-script" } },
  );
}

export { fakeNetwork, json, rouvySessionOpened };

export async function connect(options: Parameters<typeof createServer>[0]) {
  const server = createServer(options);
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

export function text(result: unknown): string {
  const content = (result as { content: { type: string; text: string }[] }).content;
  return content.map((c) => c.text).join("\n");
}
