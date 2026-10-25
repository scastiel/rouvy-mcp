import OAuthProvider, { getOAuthApi, type OAuthHelpers, type OAuthProviderOptions } from "@cloudflare/workers-oauth-provider";
import { DurableObject } from "cloudflare:workers";
import { withUserAgent } from "../http.js";
import { authorize } from "./authorize.js";
import { consoleLog, type BlockSignal, type Log } from "./log.js";
import { privacyPage } from "./pages.js";
import { observeUpstream } from "./upstream.js";
import { createRidersHost, type GrantProps, type Health, type RidersHost, type Served } from "./riders.js";

/** A Grant's idle lifetime: every refresh pushes its expiry this far out, with no hard cap. */
const GRANT_IDLE_TTL_S = 30 * 24 * 60 * 60;

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
export class Riders extends DurableObject<Env> {
  private readonly host: RidersHost;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.host = createRidersHost({ fetch: (input, init) => fetch(input, init), log: consoleLog, store: ctx.storage });
  }

  serve(request: Request, props: GrantProps): Promise<Served> {
    return this.host.serve(request, props);
  }

  recordBlockSignal(kind: BlockSignal): Promise<void> {
    return this.host.recordBlockSignal(kind);
  }

  health(): Promise<Health> {
    return this.host.health();
  }
}

function riders(env: Env): Pick<RidersHost, "serve" | "recordBlockSignal" | "health"> {
  const namespace = env.RIDERS.jurisdiction("eu");
  return namespace.get(namespace.idFromName("riders"));
}

/**
 * Firebase ended the rider's login (spec-m2 §6): revoke the Grant of the token presented, so the
 * client's refresh gets `invalid_grant` and sends the rider back to the sign-in page.
 */
async function endGrant(request: Request, oauth: OAuthHelpers, publicUrl: string, log: Log): Promise<Response> {
  // The provider's tokens are `{userId}:{grantId}:{secret}`, and it has just validated this one.
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  const [userId, grantId] = token.split(":");
  try {
    if (userId && grantId) {
      await oauth.revokeGrant(grantId, userId);
      log({ event: "grant_revoked", reason: "terminal_auth_failure" });
    }
  } catch {
    // Still a 401: the Grant lives on, so its next call meets the same Firebase answer and tries again.
  }
  const metadata = `${publicUrl}/.well-known/oauth-protected-resource/mcp`;
  return new Response(null, {
    status: 401,
    headers: { "www-authenticate": `Bearer realm="OAuth", resource_metadata="${metadata}", error="invalid_token"` },
  });
}

function createProvider(publicUrl: string, fetch: typeof globalThis.fetch, log: Log) {
  const options: OAuthProviderOptions<Env> = {
    apiRoute: "/mcp",
    apiHandler: {
      async fetch(request, env, ctx) {
        // Stateless Streamable HTTP: no session to GET or DELETE (spec-m2 §4).
        if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
        const served = await riders(env).serve(request, ctx.props as GrantProps);
        if ("response" in served) return served.response;
        return endGrant(request, getOAuthApi(options, env), publicUrl, log);
      },
    },
    defaultHandler: {
      async fetch(request, env, ctx) {
        const { pathname } = new URL(request.url);
        if (pathname === "/authorize") {
          // The sign-in page's Rouvy check can meet a block too: the Durable Object counts it.
          const onBlockSignal = (kind: BlockSignal) => ctx.waitUntil(riders(env).recordBlockSignal(kind));
          const observed = withUserAgent(observeUpstream(fetch, { log, onBlockSignal }));
          return authorize(request, { oauth: env.OAUTH_PROVIDER!, allowList: env.ALLOW_LIST, fetch: observed, log });
        }
        if (pathname === "/privacy") return privacyPage();
        if (pathname === "/health" && request.method === "GET") {
          const health = await riders(env).health();
          return Response.json(health, { status: health.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
        }
        return new Response("Not found", { status: 404 });
      },
    },
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
    resourceMetadata: { resource: `${publicUrl}/mcp`, authorization_servers: [publicUrl] },
    clientIdMetadataDocumentEnabled: true,
    // Access tokens: the default 1 h. DCR clients: the default 90 days. A Grant in use lives on;
    // one unused for 30 days is deleted (spec-m2 §5).
    refreshTokenIdleTTL: GRANT_IDLE_TTL_S,
  };
  return new OAuthProvider<Env>(options);
}

/**
 * The Worker front: OAuth and routing only (spec-m2 §3). The provider needs the canonical URL at
 * construction, and Workers only see their vars per request, so it's built on the first one.
 */
export function createWorker({
  fetch = (input, init) => globalThis.fetch(input, init),
  log = consoleLog,
}: { fetch?: typeof globalThis.fetch; log?: Log } = {}) {
  let provider: { publicUrl: string; instance: ReturnType<typeof createProvider> } | undefined;
  return {
    fetch(request, env, ctx) {
      if (provider?.publicUrl !== env.PUBLIC_URL) {
        provider = { publicUrl: env.PUBLIC_URL, instance: createProvider(env.PUBLIC_URL, fetch, log) };
      }
      if (!atTokenEndpoint(request)) return provider.instance.fetch(request, env, ctx);
      return logClientRevocation(request, (forwarded) => provider!.instance.fetch(forwarded, env, ctx), log);
    },
  } satisfies ExportedHandler<Env>;
}

/** RFC 7009: the provider also revokes at its token endpoint, on a form with a `token` and no `grant_type`. */
function atTokenEndpoint(request: Request): boolean {
  const { pathname } = new URL(request.url);
  return request.method === "POST" && pathname === "/token";
}

/** Lets the provider answer, then records a revocation it accepted: the provider has no hook for it. */
async function logClientRevocation(request: Request, forward: (request: Request) => Promise<Response>, log: Log): Promise<Response> {
  const form = await request
    .clone()
    .formData()
    .catch(() => undefined);
  const response = await forward(request);
  if (response.ok && form?.has("token") && !form.has("grant_type")) log({ event: "grant_revoked", reason: "client" });
  return response;
}

export default createWorker();
