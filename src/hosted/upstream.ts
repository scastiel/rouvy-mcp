import { isCloudflareBlock } from "../rouvy/pushback.js";
import type { BlockSignal, Log, Upstream } from "./log.js";

export interface UpstreamObserver {
  log: Log;
  /** A hard block signal went by (spec-m2 §9), already logged: the Durable Object counts them. */
  onBlockSignal?: (kind: BlockSignal) => void;
}

/**
 * Wraps the network `fetch` so every answer from Rouvy or Firebase is logged by its status alone
 * (spec-m2 §9): never the URL, which can hold an Activity id, nor headers or bodies. Other hosts
 * aren't logged. Also spots the hard block signals.
 */
export function observeUpstream(fetch: typeof globalThis.fetch, { log, onBlockSignal }: UpstreamObserver): typeof globalThis.fetch {
  const blockSignal = (kind: BlockSignal) => {
    log({ event: "block_signal", kind });
    onBlockSignal?.(kind);
  };
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const service = upstreamOf(url);
    if (!service) return fetch(input, init);
    let response: Response;
    try {
      response = await fetch(input, init);
    } catch (error) {
      log({ event: "upstream", service, status: "network_error" });
      throw error;
    }
    log({ event: "upstream", service, status: response.status });
    if (service === "rouvy" && (response.headers.get("cf-mitigated") === "challenge" || (await isCloudflareBlock(response)))) {
      blockSignal("cloudflare");
    } else if (isAuthData(url) && answered(response) && !opensSession(response)) {
      // Only ever sent with an idToken Firebase has just handed over.
      blockSignal("auth_data_refused");
    }
    return response;
  };
}

function upstreamOf({ hostname }: URL): Upstream | undefined {
  // Activity files come from Rouvy's export host.
  if (hostname === "rouvy.com" || hostname.endsWith(".rouvy.com") || hostname === "activities.virtualtraining.eu") return "rouvy";
  if (hostname === "identitytoolkit.googleapis.com" || hostname === "securetoken.googleapis.com") return "firebase";
  return undefined;
}

function isAuthData({ hostname, pathname }: URL): boolean {
  return hostname === "account.rouvy.com" && pathname === "/resources/auth.data";
}

/** Rouvy took the request and answered it: not an outage, nor a rate limit (both are normal politeness). */
function answered({ status }: Response): boolean {
  return status < 500 && status !== 429;
}

function opensSession(response: Response): boolean {
  return response.headers.getSetCookie().some((cookie) => cookie.startsWith("rouvy_session="));
}
