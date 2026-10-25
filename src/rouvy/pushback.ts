import type { Clock } from "./clock.js";
import { blockedByBotProtection, rateLimited, rouvyUnavailable } from "./errors.js";

/** How long a Cloudflare block keeps every request from going out (spec §7). */
const BLOCK_COOL_DOWN_MS = 15 * 60_000;
/** A 429's cool-down when it says nothing, and the longest one it can ask for. */
const DEFAULT_RATE_LIMIT_MS = 60_000;
const MAX_RATE_LIMIT_MS = 15 * 60_000;
/** The wait before the one retry of a GET that hit a 5xx or a network error. */
const GET_RETRY_DELAY_MS = 2_000;

/** Why nothing goes out for a while, and for how long. */
export interface CoolDown {
  reason: "rate_limited" | "blocked";
  ms: number;
}

/**
 * Wraps `fetch` so that when Rouvy pushes back, this process backs off instead of hammering it
 * (spec §7). The cool-down is in memory and process-wide: it covers every host. Errors are built
 * from the status alone, never from a response body.
 */
export function createPushback(
  fetch: typeof globalThis.fetch,
  clock: Clock,
  onCoolDown?: (coolDown: CoolDown) => void,
): typeof globalThis.fetch {
  let coolDown: { until: number; error: (now: number) => Error } | undefined;

  function startCoolDown(reason: CoolDown["reason"], ms: number, error: (until: number, now: number) => Error): never {
    const until = clock.now() + ms;
    onCoolDown?.({ reason, ms });
    coolDown = { until, error: (now) => error(until, now) };
    throw coolDown.error(clock.now());
  }

  /** One attempt; a 5xx or network error comes back as `{ unavailable }` so the caller can retry it. */
  async function attempt(input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) {
    try {
      const response = await fetch(input, init);
      return response.status >= 500 ? { unavailable: () => rouvyUnavailable(response.status) } : { response };
    } catch {
      return { unavailable: () => rouvyUnavailable() };
    }
  }

  return async (input, init) => {
    if (coolDown && clock.now() < coolDown.until) throw coolDown.error(clock.now());
    coolDown = undefined;

    let result = await attempt(input, init);
    // Only a GET is safe to send twice. Kept apart from the auth retry, which lives in the client.
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (result.unavailable && method.toUpperCase() === "GET") {
      await clock.sleep(GET_RETRY_DELAY_MS);
      result = await attempt(input, init);
    }
    if (result.unavailable) throw result.unavailable();
    const { response } = result;
    if (await isCloudflareBlock(response)) {
      startCoolDown("blocked", BLOCK_COOL_DOWN_MS, (until) => blockedByBotProtection(until));
    }
    if (response.status === 429) {
      const ms = Math.min(retryAfterMs(response.headers.get("retry-after"), clock.now()), MAX_RATE_LIMIT_MS);
      startCoolDown("rate_limited", ms, (until, now) => rateLimited(Math.ceil((until - now) / 1000)));
    }
    return response;
  };
}

/** Cloudflare's "Attention Required!" HTML page, as opposed to a plain 403 from Rouvy itself. */
export async function isCloudflareBlock(response: Response): Promise<boolean> {
  if (response.status !== 403) return false;
  if (!response.headers.get("content-type")?.includes("text/html")) return false;
  return (await response.clone().text()).includes("Attention Required");
}

/** `Retry-After` is either delay-seconds or an HTTP date. */
function retryAfterMs(header: string | null, now: number): number {
  if (header === null) return DEFAULT_RATE_LIMIT_MS;
  if (/^\s*\d+\s*$/.test(header)) return Number(header) * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? DEFAULT_RATE_LIMIT_MS : Math.max(0, date - now);
}
