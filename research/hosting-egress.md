# Hosting platforms and egress to Rouvy's Cloudflare

Research for [Hosting platforms and egress to Rouvy's Cloudflare](https://github.com/scastiel/rouvymcp/issues/32), under [Map: Hosted Rouvy MCP server — milestone 2 (web auth)](https://github.com/scastiel/rouvymcp/issues/28). Desk research only, done 2026-10-25. **No requests were sent to Rouvy.** The probe is a separate ticket.

## Question

Which hosting platforms can run the hosted rouvy-mcp server at near-zero cost, and which are likely to get past Rouvy's Cloudflare? What storage does each offer for a small encrypted per-rider record (refresh token + uid) and the allow-list? Output: a shortlist of 2–3 hosts to probe, and what the probe should measure.

## What the server needs (from the repo)

- **Runtime:** Node ≥ 22 (`package.json` `engines`). Deps: `@modelcontextprotocol/sdk@^1.32.2`, `turbo-stream@^2.4.1`, `fit-file-parser@^6.2.3`, `zod@^4`.
- **MCP transport:** SDK 1.32.2 ships both `server/streamableHttp.js` (Node `http` req/res) and `server/webStandardStreamableHttp.js` (Web `Request`/`Response`, the one that runs on Workers, Deno, Bun). Checked in `node_modules/@modelcontextprotocol/sdk/dist/esm/server/`. So one `createServer()` core can sit behind either transport.
- **Outbound hosts:** `identitytoolkit.googleapis.com` and `securetoken.googleapis.com` (Google, not behind Rouvy's Cloudflare), `account.rouvy.com` and `riders.rouvy.com` (Cloudflare), `activities.virtualtraining.eu` (Google Cloud Storage). `docs/spec-m1.md` §4, §6.
- **Work per call:** an Activity detail is about 460 KB of turbo-stream to decode, and the intervals, window-stats and streams tools parse a whole FIT file (1 Hz records, so ~3,600 records per hour of riding). That's CPU-heavy for a serverless request. `docs/spec-m1.md` §6.
- **Politeness state:** M1 keeps the one-at-a-time queue, the 1 s spacing and the 15-minute Cloudflare cool-down in process memory (`docs/spec-m1.md` §7). A hosted server shared by many riders needs one place that holds this state. In a long-lived process that's just memory. On serverless it needs a coordinator.
- **What Rouvy's Cloudflare is known to do** ([Programmatic login path past Rouvy's Cloudflare](https://github.com/scastiel/rouvymcp/issues/9)): a **UA-pattern rule** (a semver'd `rouvy-mcp/<version> (+repo)` passes, `rouvymcp-recon/0.0` gets 403), and an apparent **rate rule on login POSTs from one IP** (3 in ~15 min tripped it, on `riders.rouvy.com/login.data`). `account.rouvy.com` and `resources/auth.data` let the project UA through. Node `fetch` from a residential IP passed, so plain TLS fingerprinting or a blanket "definitely automated" challenge isn't on for these routes, at least from home IPs.

## Cloudflare's own behaviour toward the traffic

### Datacenter and cloud IPs

- Cloudflare doesn't document a "datacenter IP" penalty as such. The bot score (1–99) comes from heuristics (matching known-bad fingerprints), a supervised ML model on "request features such as headers, session characteristics, and browser signals", optional anomaly detection, and JS detections. A missing or empty User-Agent scores 1 at once. [Bot scores](https://developers.cloudflare.com/bots/concepts/bot-score/)
- Zone owners can still write WAF rules on the source ASN or IP, and Bot Fight Mode "may challenge API or mobile app traffic" and **can't be skipped with WAF custom rules** (only an IP Access rule that matches first gets around it). [Bot Fight Mode](https://developers.cloudflare.com/bots/get-started/bot-fight-mode/). Super Bot Fight Mode sorts traffic into "definitely automated", "likely automated" and "verified bots". [Super Bot Fight Mode](https://developers.cloudflare.com/bots/get-started/super-bot-fight-mode/)
- So whether a cloud IP gets through is **Rouvy's configuration, not a published Cloudflare rule**. Desk research can't answer it. That's why there's a probe. What M1 saw (an explicit UA rule plus a rate rule, and Node fetch passing) suggests custom WAF rules rather than Bot Fight Mode on these routes, which is the friendlier case for a datacenter IP with an honest UA. *Inference, not verified.*

### Cloudflare Workers calling a Cloudflare-protected zone (Rouvy)

- **Workers subrequests are labelled.** "`CF-Worker` is added to all Worker subrequests sent via `fetch()`", set to "the name of the zone which owns the Worker making the subrequest". In WAF rules it's the `cf.worker.upstream_zone` field. Cloudflare documents a one-line rule to block all Worker subrequests from other zones: `(not cf.worker.upstream_zone in {"" "your-zone.com"})`. [Cloudflare HTTP headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/), [Block Worker subrequests](https://developers.cloudflare.com/waf/custom-rules/use-cases/block-worker-subrequests/). This is honest by construction (Rouvy can see exactly whose Worker it is), but it also makes us trivially blockable.
- **Cross-zone subrequests share one source IP.** For a subrequest between Cloudflare zones, "the `CF-Connecting-IP` value will be set to the Worker client IP address", a fixed address, "for security reasons". [Cloudflare HTTP headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/). A secondhand report quoting Cloudflare support gives this as `2a06:98c0:3600::103` ([jamesqi.com](https://jamesqi.com/zh-hant/%E5%8D%9A%E5%AE%A2/%E5%85%B3%E4%BA%8ECloudflare%E7%9A%842a06:98c0:3600::103%E8%BF%99%E4%B8%AAIPv6%E5%9C%B0%E5%9D%80), not first-party). **Consequence:** if Rouvy's login rate rule is keyed on the client IP, every Worker on the planet that calls Rouvy may share our bucket, and other people's Workers abusing Rouvy may get that IP blocked. This is the biggest unknown for Workers.
- **Bot scoring of Worker subrequests isn't documented.** Bot Management fields on Orange-to-Orange (O2O) traffic "represent the eyeball (end-user) connection" ([Bot Management variables](https://developers.cloudflare.com/bots/reference/bot-management-variables/)), but that's for SaaS-style O2O, not a plain Worker calling a third party's zone. A Cloudflare staffer's forum reply calls cross-zone subrequests "obviously untrusted from the perspective of the other zone", and a 2020 thread reports Worker subrequests caught by Bot Fight Mode ([community thread](https://community.cloudflare.com/t/issue-with-worker-to-worker-https-request/94472/8)). Not first-party, and old.
- Same-zone Worker subrequests can be counted by rate limiting rules ([Rate limiting troubleshooting](https://developers.cloudflare.com/waf/rate-limiting-rules/troubleshooting)). Not our case: we're never on Rouvy's zone.

## Platforms

Prices as listed on the cited pages on 2026-10-25.

### Cloudflare Workers (+ Durable Objects, D1, KV)

- **Free plan:** 100,000 requests/day, **10 ms CPU per HTTP request**, 50 subrequests per invocation, 6 simultaneous open connections, 128 MB per isolate, no wall-clock limit on HTTP requests. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- **Paid:** $5/month minimum, 10 M requests and 30 M CPU-ms included. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- **Node compat:** `nodejs_compat` (on by default from compatibility date 2026-08-04) supports `node:crypto`, `node:fs`, `node:http(s)`, `Buffer`, streams. Unsupported APIs are unenv stubs that no-op or throw. [Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/). `turbo-stream` and `fit-file-parser` are plain JS and should bundle. *Not verified by building.* The MCP side is the SDK's web-standard transport, or Cloudflare's `createMcpHandler` (stateless) together with the Workers OAuth Provider library for MCP OAuth. `McpAgent` (Durable-Object-backed) is "deprecated and feature-frozen". [MCP transport on Workers](https://developers.cloudflare.com/agents/model-context-protocol/transport/)
- **Request model:** serverless isolates, no shared process memory. The global politeness queue and cool-down would live in **one Durable Object** (single-threaded by design), which is a good fit for "one request at a time to Rouvy across all riders".
- **Storage (all on Free):**
  - **Durable Objects (SQLite backend only on Free):** 100k requests/day, 13,000 GB-s/day, 5 M rows read and 100k rows written per day, 5 GB stored. [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
  - **D1:** 5 M rows read and 100k written per day, 5 GB. [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
  - **KV:** 100k reads but only **1,000 writes per day**, 1 GB. [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/). Fine for the allow-list and OAuth grants at invite-only scale. Rider records that change on every token refresh fit D1 or DO better.
  - Encrypt with Web Crypto (AES-GCM), key in a Worker secret.
- **Egress:** Rouvy sees `cf.worker.upstream_zone` = our zone and a shared, fixed client IP (above). Google's Firebase endpoints see Cloudflare egress IPs.
- **Risks:** the 10 ms CPU limit vs decoding a ~460 KB detail or parsing a FIT file (may force the $5 plan). Trivial for Rouvy to block with one rule. The shared-IP rate bucket. Self-hosters need a Cloudflare account, though Workers Free costs them $0 too.

### Fly.io

- **No free tier** for new orgs: a trial of 2 machine-hours or 7 days. Smallest machine (shared-cpu-1x, 256 MB) **$2.19/month**. Shared IPv4 and IPv6 free, dedicated IPv4 $2/month. Volumes $0.15/GB/month. Egress $0.02/GB (NA/EU). [Fly.io pricing](https://docs.fly.io/about/pricing)
- **Request model:** a long-lived VM-like machine running unchanged Node 22, so M1's in-memory queue, cool-down and caches carry over as is.
- **Egress:** "outbound IPs from Machines are unstable and may change". App-scoped static egress IPs (an IPv4 + IPv6 pair per region) cost ~$3.60/month. [Fly egress IPs](https://fly.io/docs/networking/egress-ips/). By default Rouvy sees a shared Fly datacenter IP that other tenants also use.
- **Storage:** a 1 GB volume holding a SQLite file (~$0.15/month). Encrypt with `node:crypto`, key in a Fly secret.
- **Cost:** ~$2.35/month without static egress, ~$6/month with it.

### Small VPS (Hetzner)

- **Price:** from €5.99/month (Cost-Optimized) or €6.49 (Regular), excl. VAT, on the [Hetzner Cloud page](https://www.hetzner.com/cloud/) as of today. IPv4 primary IP +€0.50/month, IPv6 free. [Hetzner servers overview](https://docs.hetzner.com/cloud/servers/overview/)
- **Request model:** long-lived Node 22 (or a Docker image, which doubles as the self-host package).
- **Egress:** a **dedicated, stable IP** that only we use. Best for attribution ("this IP is rouvy-mcp") and for a per-IP rate rule that counts only our own traffic. Hetzner's ASN is widely used for scraping, so ASN-level rules are a real possibility. *Inference, to probe.*
- **Storage:** SQLite on local disk, `node:crypto` encryption, key in env.
- **Oracle Cloud Always Free** looks like a $0 VPS (A1: 2 OCPU / 12 GB equivalent), but idle instances "may be reclaimed" when 95th-percentile CPU, network and memory all stay below 20% over 7 days. [OCI Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm). An invite-only MCP server is idle almost all the time, so it's not a reliable public host.

### Render (free)

- Free web services spin down after 15 minutes idle and take **about 1 minute** to spin up. 750 instance-hours/month. **No persistent disk.** Free Postgres expires 30 days after creation. Free Key Value is in-memory only. [Render free](https://render.com/docs/free)
- Outbound IPs come from regional ranges shared by all Render services. Dedicated IPs need Pro. [Render outbound IPs](https://render.com/docs/outbound-ip-addresses)
- **Verdict:** out for the public instance. A one-minute cold start in the middle of an MCP OAuth flow or a tool call, and nowhere durable to keep refresh tokens for free.

### Railway

- **Free:** $1 of credit/month (0.5 GB RAM, 0.5 GB volume). **Hobby:** $5/month including $5 of usage. RAM $10/GB/month, CPU $20/vCPU/month, egress $0.05/GB, volumes $0.15/GB/month. [Railway plans](https://docs.railway.com/reference/pricing/plans)
- Static outbound IPs are **Pro-only**, IPv4, and may be shared. [Railway static outbound IPs](https://docs.railway.com/reference/static-outbound-ips)
- **Verdict:** a 256 MB always-on service already costs about $2.50 of RAM a month, beyond the free $1. On Hobby it's a $5 floor, the same as Workers Paid, with a shared IP. Nothing here that Fly doesn't do cheaper.

### Vercel (Hobby)

- Free, but "restricts users to non-commercial, personal use only". Functions up to 300 s. 4 active-CPU-hours, 360 GB-hrs memory and 1 M invocations a month. Storage on the plan: Blob. [Vercel Hobby](https://vercel.com/docs/plans/hobby)
- Serverless like Workers but without a Durable-Object equivalent for the global queue, and with egress from shared AWS ranges. **Verdict:** no advantage over Workers for this server. Netlify Functions are in the same bucket. Not researched further.

## Comparison

| | Workers Free | Fly.io | Hetzner VPS |
|---|---|---|---|
| Monthly cost | $0 (maybe $5 if CPU forces Paid) | ~$2.35, ~$6 with static egress | ~€6.50 |
| Runs M1 code unchanged | No: web-standard transport, DO for the queue | Yes | Yes |
| Global politeness state | One Durable Object | Process memory | Process memory |
| Rider-record storage | D1 or DO SQLite (KV for allow-list) | SQLite on a volume | SQLite on disk |
| What Rouvy sees | `CF-Worker: <our zone>`, fixed IP shared by all Workers | Shared, changing Fly IP (or a static pair) | Our own stable IP |
| Main egress risk | One-line block rule; shared rate bucket | Neighbours' reputation on a shared IP | Hetzner ASN rules |
| Self-host story | `wrangler deploy`, free | `fly launch`, a few $ | Docker anywhere |

## Shortlist to probe

1. **Cloudflare Workers Free (+ D1 or a DO for rider records, a DO for the global queue, KV for the allow-list).** The only truly $0 option, and the cheapest for self-hosters. But its egress is the most unusual (labelled, fixed shared IP) and its CPU budget is tight, so it must be measured, not assumed.
2. **Fly.io, smallest machine + 1 GB volume.** Cheapest long-lived Node host. Runs the M1 code unchanged. Tests how a shared cloud IP is treated, and the static-egress option is there if needed.
3. **Hetzner VPS (or whatever VPS the maintainer already has).** Dedicated IP, Docker, and also the reference self-host target. It tests whether a *dedicated* datacenter IP passes, which separates "cloud ASN blocked" from "shared IP blocked".

Render, Railway and Vercel are out (see verdicts above). The interesting result is the *pattern* across the three: if all pass, pick on cost (Workers) or simplicity (Fly). If only the VPS passes, shared-IP reputation is the issue. If none pass, the hosted route goes back to the map (self-host from a residential IP only).

## What the probe should measure

Same rules as M1's probes ([Programmatic login path past Rouvy's Cloudflare](https://github.com/scastiel/rouvymcp/issues/9)): honest UA `rouvy-mcp/<version> (+https://github.com/scastiel/rouvy-mcp)`, the maintainer's own account, one request at a time with ≥ 1 s spacing, stop at the first Cloudflare 403, record only statuses, header names and attributes, timings and hashes. **Exactly one real login per host** (the login rate rule). Never try to find rate thresholds.

For each host:

1. **Egress identity:** the egress IP and ASN, read from a neutral echo service. Is it stable across two deploys or restarts? On Workers, also hit a Cloudflare zone we control to log what a zone owner sees: `cf.worker.upstream_zone`, `CF-Connecting-IP`, and the bot score if the zone has it.
2. **Anonymous Rouvy GETs** (same as the canary): `riders.rouvy.com/resources/activities-pagination.data` and the `account.rouvy.com` sign-in page. Expect 202 + `SingleFetchRedirect` and 200, versus a 403 HTML challenge. Record the `cf-mitigated` header, `cf-ray` colo, and whether `__cf_bm` is set.
3. **Firebase from the host:** a bogus-credential `signInWithPassword` should return `INVALID_LOGIN_CREDENTIALS`. This checks that Google doesn't block the egress.
4. **One real login:** Firebase sign-in, then `POST account.rouvy.com/resources/auth.data` → 202 + `Set-Cookie: rouvy_session`. Then one `securetoken` refresh.
5. **Authenticated reads:** one list page, one detail (~460 KB), and its FIT file from `activities.virtualtraining.eu`. Record status and wall time.
6. **Workers only: cost.** CPU-ms per invocation for (a) decoding the detail and (b) parsing the FIT file, against the 10 ms Free limit (Workers observability / `wrangler tail`), plus peak memory against 128 MB. Also check that `turbo-stream`, `fit-file-parser` and the SDK's web-standard transport bundle and run under `nodejs_compat`.
7. **Over time:** repeat step 2 once a day for ~3 days. Some blocks only show up after a reputation update.

## Open questions surfaced

- **Budget ceiling:** is $5/month (Workers Paid, Railway Hobby) or ~€6.50 (VPS) still "near-zero"? The answer may be forced by the Workers CPU measurement.
- **Shared Workers IP vs Rouvy's per-IP login rate rule:** if Workers is picked, should the server ask Rouvy to allow-list our `cf.worker.upstream_zone`, rather than share a rate bucket with every Worker? This ties into the operator-risk research and to politeness at scale.
- **Portability:** to keep one codebase for both Workers and Node self-hosts, `createServer()` would need to sit behind the web-standard transport, with storage and the queue behind small interfaces (DO/D1 on Workers, memory/SQLite on Node).
