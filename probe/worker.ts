// Cloudflare Worker entry point. Every route needs `Authorization: Bearer <PROBE_KEY>`, so nobody
// else can make this Worker call Rouvy.
//   GET  /checks         account-free checks
//   GET  /bench/detail   decode + parse a ~490 KB detail (one workload per invocation, for CPU time)
//   GET  /bench/fit      parse a 1 h Activity file + splits + window stats
//   GET  /authed         one refresh + list + detail + Activity file (secrets ROUVY_REFRESH_TOKEN, ROUVY_UID)
//   POST /mcp            the real createServer() over the SDK's web-standard Streamable HTTP transport
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Credentials } from "../src/credentials/types.js";
import { withUserAgent } from "../src/http.js";
import { systemClock } from "../src/rouvy/clock.js";
import { createRequestQueue } from "../src/rouvy/request-queue.js";
import { createServer } from "../src/server.js";
import { authedReads } from "./authed.js";
import { benchActivityFile, benchDetail } from "./bench.js";
import { accountFreeChecks } from "./checks.js";
import fitBytes from "./inputs/synthetic-1h.fit";
import detailText from "./inputs/synthetic-detail.data";

interface Env {
  PROBE_KEY: string;
  ROUVY_REFRESH_TOKEN?: string;
  ROUVY_UID?: string;
}

const json = (value: unknown, status = 200) => Response.json(value, { status });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.PROBE_KEY || request.headers.get("authorization") !== `Bearer ${env.PROBE_KEY}`) {
      return json({ error: "unauthorized" }, 401);
    }
    const politeFetch = withUserAgent(createRequestQueue(globalThis.fetch, systemClock));
    const credentials = (): Credentials | null =>
      env.ROUVY_REFRESH_TOKEN && env.ROUVY_UID ? { refreshToken: env.ROUVY_REFRESH_TOKEN, uid: env.ROUVY_UID } : null;
    const { pathname } = new URL(request.url);

    switch (pathname) {
      case "/checks":
        return json({ host: "cloudflare-workers", colo: request.cf?.colo, checks: await accountFreeChecks(politeFetch) });
      case "/bench/detail":
        return json(await benchDetail(detailText));
      case "/bench/fit":
        return json(await benchActivityFile(fitBytes.buffer.slice(fitBytes.byteOffset, fitBytes.byteOffset + fitBytes.byteLength)));
      case "/authed": {
        const stored = credentials();
        return stored ? json(await authedReads(politeFetch, stored)) : json({ error: "no credentials" }, 400);
      }
      case "/mcp": {
        // Stateless: a fresh server per request, as a serverless host would run it.
        let stored = credentials();
        const server = createServer({
          credentials: { load: async () => stored, save: async (next) => void (stored = next) },
        });
        const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        await server.connect(transport);
        return transport.handleRequest(request);
      }
      default:
        return json({ error: "not found" }, 404);
    }
  },
};
