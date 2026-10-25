import OAuthProvider, { type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { DurableObject } from "cloudflare:workers";
import { withUserAgent } from "../http.js";
import { authorize } from "./authorize.js";
import { privacyPage } from "./pages.js";
import { createRidersHost, type GrantProps, type RidersHost } from "./riders.js";

export interface Env {
  /** The provider's clients, Grants and tokens. Nothing else is stored (spec-m2 §3). */
  OAUTH_KV: KVNamespace;
  RIDERS: DurableObjectNamespace<Riders>;
  /** This deployment's origin, e.g. `https://mcp.example.com`. Its `/mcp` is the OAuth audience: never change it once riders have connected. */
  PUBLIC_URL: string;
  /** The riders' Rouvy emails, separated by commas or whitespace (a Worker secret). Unset: nobody. */
  ALLOW_LIST?: string;
  /** Set by the provider before it calls our handlers. */
  OAUTH_PROVIDER?: OAuthHelpers;
}

/** The single Durable Object, in the EU jurisdiction, that plays "the M1 process" (spec-m2 §3). */
export class Riders extends DurableObject<Env> implements RidersHost {
  private readonly host = createRidersHost({ fetch: (input, init) => fetch(input, init) });

  serve(request: Request, props: GrantProps): Promise<Response> {
    return this.host.serve(request, props);
  }
}

function riders(env: Env): RidersHost {
  const namespace = env.RIDERS.jurisdiction("eu");
  return namespace.get(namespace.idFromName("riders"));
}

function createProvider(publicUrl: string, fetch: typeof globalThis.fetch) {
  return new OAuthProvider<Env>({
    apiRoute: "/mcp",
    apiHandler: {
      fetch(request, env, ctx) {
        // Stateless Streamable HTTP: no session to GET or DELETE (spec-m2 §4).
        if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
        return riders(env).serve(request, ctx.props as GrantProps);
      },
    },
    defaultHandler: {
      fetch(request, env) {
        const { pathname } = new URL(request.url);
        if (pathname === "/authorize") {
          return authorize(request, { oauth: env.OAUTH_PROVIDER!, allowList: env.ALLOW_LIST, fetch });
        }
        if (pathname === "/privacy") return privacyPage();
        return new Response("Not found", { status: 404 });
      },
    },
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
    resourceMetadata: { resource: `${publicUrl}/mcp`, authorization_servers: [publicUrl] },
    clientIdMetadataDocumentEnabled: true,
  });
}

/**
 * The Worker front: OAuth and routing only (spec-m2 §3). The provider needs the canonical URL at
 * construction, and Workers only see their vars per request, so it's built on the first one.
 */
export function createWorker({ fetch = (input, init) => globalThis.fetch(input, init) }: { fetch?: typeof globalThis.fetch } = {}) {
  let provider: { publicUrl: string; instance: ReturnType<typeof createProvider> } | undefined;
  return {
    fetch(request, env, ctx) {
      if (provider?.publicUrl !== env.PUBLIC_URL) {
        provider = { publicUrl: env.PUBLIC_URL, instance: createProvider(env.PUBLIC_URL, withUserAgent(fetch)) };
      }
      return provider.instance.fetch(request, env, ctx);
    },
  } satisfies ExportedHandler<Env>;
}

export default createWorker();
