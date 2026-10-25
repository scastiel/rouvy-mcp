import type { CoolDown } from "../rouvy/pushback.js";
import type { ToolOutcome } from "../server.js";

/**
 * The hosted server's own structured events, the only lines it logs (spec-m2 §9). Each event
 * names what it may carry, so a uid, email, IP address, token or `props` can't be passed by
 * accident: support matches a rider's report by timestamp.
 */
export type LogEvent =
  /** A tool call ended. `outcome` is a category, never the message the rider saw. */
  | { event: "tool_call"; tool: string; outcome: ToolOutcome; duration_ms: number }
  /** Rouvy or Firebase answered: the status only, never the URL (it can hold an Activity id) or the body. */
  | { event: "upstream"; service: Upstream; status: number | "network_error" }
  /** Rouvy pushed back, so nothing goes out for a while. */
  | { event: "cool_down"; reason: CoolDown["reason"]; seconds: number }
  | { event: "block_signal"; kind: BlockSignal }
  | { event: "grant_created" }
  /** `client`: the client revoked its token. `terminal_auth_failure`: Firebase ended the rider's login. */
  | { event: "grant_revoked"; reason: "client" | "terminal_auth_failure" }
  | { event: "refresh_token_rotated"; rotations: number }
  /**
   * The Durable Object started, with no rider in memory. Other than right after a deploy, this
   * means the previous one was evicted, and every live Session with it.
   */
  | { event: "durable_object_started" }
  /** `/health` ran the canary checks rather than answering from its cache. */
  | { event: "health_checked"; failing: number };

export type Upstream = "rouvy" | "firebase";

/**
 * A hard block signal (spec-m2 §9): `cloudflare` is a Cloudflare 403 or challenge in front of
 * Rouvy, `auth_data_refused` is Rouvy refusing `auth.data` despite a fresh idToken.
 */
export type BlockSignal = "cloudflare" | "auth_data_refused";

export type Log = (event: LogEvent) => void;

/** One JSON line per event, which Workers Logs indexes. */
export const consoleLog: Log = (event) => console.log(JSON.stringify(event));
