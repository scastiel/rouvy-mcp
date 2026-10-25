import { ROUVY_FIREBASE_WEB_KEY } from "./constants.js";
import { withUserAgent } from "./http.js";
import { LIST_ROUTE } from "./rouvy/schemas.js";
import { asRedirect, decodeSingleFetch } from "./rouvy/turbo-stream.js";

export interface CanaryCheck {
  name: string;
  ok: boolean;
  /** What was seen, in a line a maintainer can act on. */
  detail: string;
}

/** Well-formed, but no Activity has it. */
export const BOGUS_ACTIVITY_ID = "000000000000-canary00";

/**
 * Account-free checks that Rouvy still answers the way rouvy-mcp expects. Read-only: GETs to
 * Rouvy, no cookies, and one sign-in attempt with made-up credentials at Firebase, never at Rouvy.
 */
export async function runCanary(fetch: typeof globalThis.fetch): Promise<CanaryCheck[]> {
  const honestFetch = withUserAgent(fetch);
  const checks: [string, (fetch: typeof globalThis.fetch) => Promise<CheckResult>][] = [
    ["anonymous GET of the Activity list", (f) => anonymousRead(f, `/resources/activities-pagination.data?offset=0&_routes=${encodeURIComponent(LIST_ROUTE)}`)],
    ["anonymous GET of an Activity detail", (f) => anonymousRead(f, `/activity/${BOGUS_ACTIVITY_ID}.data`)],
    ["Firebase sign-in with the pinned key and made-up credentials", firebaseKeyWorks],
    ["account.rouvy.com/sign-in still carries the pinned Firebase key", signInPageHasKey],
  ];
  const results: CanaryCheck[] = [];
  // One at a time, like the server: ~4 requests a day, never a burst.
  for (const [name, check] of checks) {
    try {
      results.push({ name, ...(await check(honestFetch)) });
    } catch (error) {
      results.push({ name, ok: false, detail: `request failed: ${(error as Error).message}` });
    }
  }
  return results;
}

type CheckResult = Omit<CanaryCheck, "name">;

async function anonymousRead(fetch: typeof globalThis.fetch, path: string): Promise<CheckResult> {
  const response = await fetch(new URL(path, "https://riders.rouvy.com"), { redirect: "manual" });
  if (response.status === 403 && response.headers.get("content-type")?.startsWith("text/html")) {
    return { ok: false, detail: "Cloudflare answered 403 with an HTML page: its user-agent rule probably changed" };
  }
  let payload: unknown;
  try {
    payload = await decodeSingleFetch(response.body ?? new Blob([]).stream());
  } catch {
    return { ok: false, detail: `HTTP ${response.status}, not a turbo-stream v2 payload: the encoding changed` };
  }
  const redirect = asRedirect(payload);
  const target = redirect && new URL(redirect.redirect, response.url || "https://riders.rouvy.com");
  if (response.status === 202 && target?.host === "account.rouvy.com" && target.pathname === "/sign-in") {
    return { ok: true, detail: "202, redirect to sign-in" };
  }
  const seen = redirect ? `a redirect to ${target?.origin}${target?.pathname}` : "no redirect to sign-in";
  return { ok: false, detail: `HTTP ${response.status} with ${seen}` };
}

async function firebaseKeyWorks(fetch: typeof globalThis.fetch): Promise<CheckResult> {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${ROUVY_FIREBASE_WEB_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "canary@rouvy-mcp.invalid", password: "not-a-password", returnSecureToken: true }),
    },
  );
  // Only made-up credentials went in, so the message can be shown whole.
  const message = firebaseErrorMessage(await response.json().catch(() => null));
  const ok = message === "INVALID_LOGIN_CREDENTIALS";
  return { ok, detail: `Firebase answered HTTP ${response.status}: ${message ?? "no error message"}` };
}

async function signInPageHasKey(fetch: typeof globalThis.fetch): Promise<CheckResult> {
  const response = await fetch("https://account.rouvy.com/sign-in");
  const ok = response.status === 200 && (await response.text()).includes(ROUVY_FIREBASE_WEB_KEY);
  return { ok, detail: ok ? "key found" : `key not found (HTTP ${response.status})` };
}

function firebaseErrorMessage(body: unknown): string | undefined {
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof message === "string" ? message.slice(0, 200) : undefined;
}
