import {
  createMcpHandler,
  isLegacyRequest,
  WebStandardStreamableHTTPServerTransport,
  type McpServer,
} from "@modelcontextprotocol/server";
import type { Credentials } from "../credentials/types.js";
import { systemClock, type Clock } from "../rouvy/clock.js";
import { createPoliteFetch, createRider, createServer, type Rider } from "../server.js";

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
}

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
export function createRidersHost({ fetch, clock = systemClock }: { fetch: typeof globalThis.fetch; clock?: Clock }): RidersHost {
  const politeFetch = createPoliteFetch(fetch, clock);
  const riders = new Map<string, Instance>();
  const inTurn = createTurns();
  let rotations = 0;

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

  return {
    serve(request, props) {
      dropIdle();
      return inTurn(props.uid, async () => {
        const instance = instanceFor(props);
        let grantEnded = false;
        const server = () =>
          createServer({ rider: instance.rider, notLoggedInMessage, onTerminalAuthFailure: () => (grantEnded = true) });
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
