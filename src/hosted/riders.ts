import {
  createMcpHandler,
  isLegacyRequest,
  WebStandardStreamableHTTPServerTransport,
  type McpServer,
} from "@modelcontextprotocol/server";
import { runCanary, type CanaryCheck } from "../canary.js";
import type { Credentials } from "../credentials/types.js";
import { systemClock, type Clock } from "../rouvy/clock.js";
import { createPoliteFetch, createRider, createServer, type Rider } from "../server.js";
import { createBlockSignals, type Store } from "./block-signals.js";
import type { BlockSignal, Log } from "./log.js";
import { observeUpstream } from "./upstream.js";

/** How long a rider's instance outlives their last call. */
const IDLE_MS = 30 * 60_000;

/** A rider's instance in the Durable Object: their Rider (live Session, cookies, caches), in memory only. */
interface Instance {
  rider: Rider;
  /** Points the Rider at the refresh token of the Grant being served. */
  use(props: GrantProps): void;
  lastUsed: number;
  busy: boolean;
}

/** What a Grant carries for us, encrypted by the OAuth provider (spec-m2 §5, §6). */
export interface GrantProps {
  refreshToken: string;
  uid: string;
  email: string;
}

/**
 * The Durable Object's answer to one `/mcp` request: the MCP response, or word that Firebase ended
 * the rider's login, so the Worker revokes the Grant and answers 401 (spec-m2 §6).
 */
export type Served = { response: Response } | { grantEnded: true };

/** What the Durable Object does with each `/mcp` request the Worker forwards to it. */
export interface RidersHost {
  serve(request: Request, props: GrantProps): Promise<Served>;
  /** How many times Firebase has handed back a new refresh token, so we notice (spec-m2 §6). Never the tokens. */
  refreshTokenRotations(): number;
  /** Counts a hard block signal the Worker saw, on the sign-in page (spec-m2 §9). */
  recordBlockSignal(kind: BlockSignal): Promise<void>;
  /** What `GET /health` reports (spec-m2 §9). */
  health(): Promise<Health>;
}

/** No personal data: the account-free checks, and how many block signals the last 24 h saw. */
export interface Health {
  /** False when a check fails, or when hard block signals have persisted for over an hour: a block. */
  ok: boolean;
  checkedAt: string;
  checks: CanaryCheck[];
  blockSignals: Record<BlockSignal, number> & {
    /** The first and last of the last 24 h are over an hour apart. */
    persisting: boolean;
  };
}

/** Rouvy sees the `/health` checks at most this often (spec-m2 §9). */
const HEALTH_TTL_MS = 60 * 60_000;
const HEALTH_KEY = "health";

/** Nothing on the hosted server mentions the stdio login command: the rider reconnects in their client. */
function notLoggedInMessage(terminal: boolean): string {
  return terminal
    ? "Your Rouvy sign-in has ended. Reconnect rouvy-mcp in your MCP client, then retry."
    : "Couldn't open a Rouvy session right now. Try again later.";
}

/**
 * "The M1 process" of the hosted server (spec-m2 §3): one polite fetch shared by every rider, so
 * the request budget and cool-down are global, and one Rider (live Session, caches) per uid, all
 * in memory. Each request gets its own MCP server around its rider's Rider.
 */
export function createRidersHost({
  fetch,
  clock = systemClock,
  log,
  store,
}: {
  fetch: typeof globalThis.fetch;
  clock?: Clock;
  log: Log;
  /** The Durable Object's storage: only block signals and the `/health` cache go there. */
  store: Store;
}): RidersHost {
  const blockSignals = createBlockSignals(store, clock);
  const recordBlockSignal = (kind: BlockSignal) => blockSignals.record(kind).catch(() => {});
  const observedFetch = observeUpstream(fetch, { log, onBlockSignal: (kind) => void recordBlockSignal(kind) });
  const politeFetch = createPoliteFetch(observedFetch, clock, {
    onCoolDown: ({ reason, ms }) => log({ event: "cool_down", reason, seconds: Math.ceil(ms / 1000) }),
  });
  const riders = new Map<string, Instance>();
  const inTurn = createTurns();
  let rotations = 0;
  log({ event: "durable_object_started" });

  /**
   * Drops the instances idle for 30 minutes (spec-m2 §7.3), never one with a call in flight. Swept
   * on each request: with no requests at all, the Durable Object is evicted, and everything with it.
   */
  function dropIdle() {
    for (const [uid, instance] of riders) {
      if (!instance.busy && clock.now() - instance.lastUsed >= IDLE_MS) riders.delete(uid);
    }
  }

  /**
   * One Rider per uid, however many Grants (clients) the rider has: its live Session is reused
   * and renewed only when missing or near expiry (spec-m2 §6). `load()` returns the refresh token
   * of the Grant being served, or the one Firebase rotated it to, which only lives here.
   */
  function instanceFor(props: GrantProps): Instance {
    let instance = riders.get(props.uid);
    if (!instance) {
      // Each Grant's refresh token (a Grant's never changes), to the latest Firebase handed back for it.
      const latestTokens = new Map<string, string>();
      let grantToken = props.refreshToken;
      let credentials: Credentials = { refreshToken: props.refreshToken, uid: props.uid, email: props.email };
      const rider = createRider({
        credentials: {
          load: async () => credentials,
          // Only renewals save, and only a token Firebase rotated: it lives here, never in props.
          save: async (rotated) => {
            credentials = rotated;
            latestTokens.set(grantToken, rotated.refreshToken);
            rotations++;
            log({ event: "refresh_token_rotated", rotations });
          },
        },
        politeFetch,
        clock,
      });
      instance = {
        rider,
        use(latest) {
          if (latest.refreshToken === grantToken) return;
          grantToken = latest.refreshToken;
          const refreshToken = latestTokens.get(grantToken) ?? grantToken;
          credentials = { refreshToken, uid: latest.uid, email: latest.email };
        },
        lastUsed: clock.now(),
        busy: false,
      };
      riders.set(props.uid, instance);
    }
    instance.use(props);
    return instance;
  }

  let checking: Promise<{ at: number; checks: CanaryCheck[] }> | undefined;

  /** M1's canary, from this egress, cached in storage so an eviction doesn't send it again. */
  async function canaryChecks() {
    const cached = await store.get<{ at: number; checks: CanaryCheck[] }>(HEALTH_KEY);
    if (cached && clock.now() - cached.at < HEALTH_TTL_MS) return cached;
    checking ??= (async () => {
      try {
        const fresh = { at: clock.now(), checks: await runCanary(observedFetch) };
        await store.put(HEALTH_KEY, fresh);
        log({ event: "health_checked", failing: fresh.checks.filter((check) => !check.ok).length });
        return fresh;
      } finally {
        checking = undefined;
      }
    })();
    return checking;
  }

  return {
    async health() {
      const { at, checks } = await canaryChecks();
      const signals = await blockSignals.lastDay();
      const persisting = signals.length > 0 && signals[signals.length - 1]!.at - signals[0]!.at > HEALTH_TTL_MS;
      const count = (kind: BlockSignal) => signals.filter((signal) => signal.kind === kind).length;
      return {
        ok: checks.every((check) => check.ok) && !persisting,
        checkedAt: new Date(at).toISOString(),
        checks,
        blockSignals: { cloudflare: count("cloudflare"), auth_data_refused: count("auth_data_refused"), persisting },
      };
    },
    serve(request, props) {
      dropIdle();
      return inTurn(props.uid, async () => {
        const instance = instanceFor(props);
        let grantEnded = false;
        const server = () =>
          createServer({
            rider: instance.rider,
            notLoggedInMessage,
            onTerminalAuthFailure: () => (grantEnded = true),
            onToolCall: ({ tool, outcome, durationMs }) => log({ event: "tool_call", tool, outcome, duration_ms: durationMs }),
          });
        instance.busy = true;
        let response: Response;
        try {
          response = await handle(request, server);
        } finally {
          instance.busy = false;
          instance.lastUsed = clock.now();
        }
        if (!grantEnded) return { response };
        // Its Session is gone for good: the instance goes with the Grant.
        riders.delete(props.uid);
        return { grantEnded };
      });
    },
    refreshTokenRotations: () => rotations,
    recordBlockSignal,
  };
}

/**
 * At most one call in flight per rider (spec-m2 §8): `run` starts once the uid's previous call has
 * ended. Other riders only ever wait for the shared polite queue.
 */
function createTurns() {
  const tails = new Map<string, Promise<void>>();
  return function inTurn<T>(uid: string, run: () => Promise<T>): Promise<T> {
    const turn = (tails.get(uid) ?? Promise.resolve()).then(run);
    const tail = turn.then(
      () => {},
      () => {},
    );
    tails.set(uid, tail);
    void tail.then(() => {
      if (tails.get(uid) === tail) tails.delete(uid);
    });
    return turn;
  };
}

/**
 * Stateless, JSON responses, no SSE (spec-m2 §4). The SDK's own 2025-era fallback streams its
 * answers, so that era gets a JSON-only transport here.
 */
async function handle(request: Request, server: () => McpServer): Promise<Response> {
  if (!(await isLegacyRequest(request))) {
    return createMcpHandler(server, { legacy: "reject", responseMode: "json" }).fetch(request);
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const instance = server();
  await instance.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await instance.close();
  }
}
