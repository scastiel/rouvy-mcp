---
status: accepted
---

# Host the web server on Cloudflare Workers, with one Durable Object as the M1 process

The hosted rouvy-mcp server (M2) runs on **Cloudflare Workers Paid**, both the public instance and the documented self-host recipe. A Worker front handles MCP OAuth with `workers-oauth-provider` and routes requests. **One Durable Object runs `createServer()`** and keeps M1's in-memory model unchanged: the one-at-a-time request queue, the process-wide cool-down, the per-uid caches and each rider's live Session.

Workers was the only candidate host we probed. Rouvy's Cloudflare let both anonymous and authenticated traffic through, and the whole M1 server ran there with one shim. Its OAuth library is built for "our own login page plus a per-grant upstream secret". A single-threaded Durable Object gives the global politeness state that M1 keeps in one process.

Sources: [Hosting platform and storage for the hosted server](https://github.com/scastiel/rouvymcp/issues/36), [Probe Rouvy from candidate hosts](https://github.com/scastiel/rouvymcp/issues/33), [OAuth authorization server options for a Rouvy-credential login](https://github.com/scastiel/rouvymcp/issues/31).

## Considered options

- **Fly.io, or a VPS, with `oidc-provider` on Node.** These are cheaper (Fly.io ~$2.35/month) or more independent, and they run M1 unchanged. Rejected because neither egress was probed, and we would own more of the authorization server.
- **Workers Free.** Rejected: tool calls use 57–305 ms of CPU against a 10 ms limit.

## Consequences

- **Cost.** $5/month for the operator, and for every self-hoster. The free option is the stdio `npx rouvy-mcp`, and there's no Node/Docker HTTP build in M2.
- **Easy to block.** Every request to Rouvy names our zone in a `CF-Worker` header, so Rouvy can block it with one rule. That fits the honest-UA stance and the shutdown tripwire.
- **Shared thread.** All riders share the Durable Object's single thread, so a slow decode delays the next rider.
- **Evictions.** After an eviction, caches and Sessions are rebuilt on the next call.
- **Code change.** `src/constants.ts` must stop reading `package.json` from disk.
