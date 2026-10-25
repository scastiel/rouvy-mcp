import { createMcpHandler, isLegacyRequest, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import type { Credentials } from "../credentials/types.js";
import { systemClock, type Clock } from "../rouvy/clock.js";
import { createPoliteFetch, createRider, createServer, type Rider } from "../server.js";

/** What a Grant carries for us, encrypted by the OAuth provider (spec-m2 §5, §6). */
export interface GrantProps {
  refreshToken: string;
  uid: string;
  email: string;
}

/** What the Durable Object does with each `/mcp` request the Worker forwards to it. */
export interface RidersHost {
  serve(request: Request, props: GrantProps): Promise<Response>;
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
  const riders = new Map<string, { rider: Rider; grantToken: string; credentials: Credentials }>();

  function riderFor(props: GrantProps): Rider {
    let entry = riders.get(props.uid);
    // A Grant's refresh token never changes; Firebase's rotations only live here (spec-m2 §6). A
    // different one in props means a new sign-in, which wins.
    if (!entry || entry.grantToken !== props.refreshToken) {
      const credentials: Credentials = { refreshToken: props.refreshToken, uid: props.uid, email: props.email };
      const next = { grantToken: props.refreshToken, credentials, rider: undefined as unknown as Rider };
      next.rider = createRider({
        credentials: {
          load: async () => next.credentials,
          save: async (rotated) => void (next.credentials = rotated),
        },
        politeFetch,
        clock,
      });
      riders.set(props.uid, next);
      entry = next;
    }
    return entry.rider;
  }

  return {
    async serve(request, props) {
      const rider = riderFor(props);
      const server = () => createServer({ rider, notLoggedInMessage });
      // Stateless, JSON responses, no SSE (spec-m2 §4). The SDK's own 2025-era fallback streams
      // its answers, so that era gets a JSON-only transport here.
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
    },
  };
}
