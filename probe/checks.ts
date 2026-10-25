import { ROUVY_FIREBASE_WEB_KEY } from "../src/constants.js";
import { asRedirect, decodeSingleFetch } from "../src/rouvy/turbo-stream.js";

/**
 * The account-free checks, the same as the daily canary's: what a host's egress looks like, and
 * whether Rouvy and Firebase answer it as they answer a home connection. No POSTs to Rouvy.
 * `fetch` must already be polite (one at a time, 1 s apart, honest UA).
 */
export interface CheckResult {
  name: string;
  ok: boolean;
  status?: number;
  /** Only header names and Cloudflare attributes, never bodies or cookie values. */
  detail: Record<string, unknown>;
}

export async function accountFreeChecks(fetch: typeof globalThis.fetch): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const check of [egress, anonymousList, signInPage, bogusFirebaseSignIn]) {
    const result = await check(fetch).catch(
      (error: unknown): CheckResult => ({ name: check.name, ok: false, detail: { error: String(error) } }),
    );
    results.push(result);
    // Politeness charter: the first Cloudflare challenge ends the run, never retried.
    if (result.detail.cloudflareChallenge) break;
  }
  return results;
}

/** Egress IP (hashed, so a home IP is never printed), ASN and country, from a neutral echo. */
async function egress(fetch: typeof globalThis.fetch): Promise<CheckResult> {
  const response = await fetch("https://ipinfo.io/json", { headers: { accept: "application/json" } });
  const info = (await response.json()) as { ip?: string; org?: string; country?: string };
  return {
    name: "egress",
    ok: response.ok,
    status: response.status,
    detail: { ipHash: info.ip ? await sha256Prefix(info.ip) : undefined, ipVersion: info.ip?.includes(":") ? 6 : 4, org: info.org, country: info.country },
  };
}

/** Expect 202 + a turbo-stream v2 `SingleFetchRedirect` to account.rouvy.com/sign-in. */
async function anonymousList(fetch: typeof globalThis.fetch): Promise<CheckResult> {
  const url = "https://riders.rouvy.com/resources/activities-pagination.data?offset=0&_routes=routes%2Fresources.activities-pagination";
  const response = await fetch(url, { redirect: "manual" });
  const detail = cloudflare(response);
  if (response.status === 202 && response.body) {
    try {
      const target = asRedirect(await decodeSingleFetch(response.body))?.redirect ?? "";
      detail.redirectsToSignIn = new URL(target).host === "account.rouvy.com" && new URL(target).pathname.startsWith("/sign-in");
    } catch {
      detail.decodeFailed = true;
    }
  } else {
    await response.body?.cancel();
  }
  return { name: "anonymousList", ok: detail.redirectsToSignIn === true, status: response.status, detail };
}

/** Expect 200, still carrying the pinned Firebase web key. */
async function signInPage(fetch: typeof globalThis.fetch): Promise<CheckResult> {
  const response = await fetch("https://account.rouvy.com/sign-in", { redirect: "manual" });
  const detail = cloudflare(response);
  const body = await response.text();
  detail.hasPinnedFirebaseKey = body.includes(ROUVY_FIREBASE_WEB_KEY);
  return { name: "signInPage", ok: response.status === 200 && detail.hasPinnedFirebaseKey === true, status: response.status, detail };
}

/** Expect INVALID_LOGIN_CREDENTIALS (not API_KEY_INVALID, not a block of the egress by Google). */
async function bogusFirebaseSignIn(fetch: typeof globalThis.fetch): Promise<CheckResult> {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${ROUVY_FIREBASE_WEB_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "probe@example.invalid", password: crypto.randomUUID(), returnSecureToken: true }),
    },
  );
  const code = ((await response.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message;
  return { name: "bogusFirebaseSignIn", ok: code === "INVALID_LOGIN_CREDENTIALS", status: response.status, detail: { code } };
}

function cloudflare(response: Response): Record<string, unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  return {
    cloudflareChallenge: response.status === 403 && contentType.includes("text/html"),
    cfMitigated: response.headers.get("cf-mitigated") ?? undefined,
    colo: response.headers.get("cf-ray")?.split("-")[1],
    contentType,
    cookiesSet: response.headers.getSetCookie().map((cookie) => cookie.split("=")[0]),
  };
}

async function sha256Prefix(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest).slice(0, 6)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
