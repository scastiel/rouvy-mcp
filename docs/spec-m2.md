# rouvy-mcp — Milestone 2 spec (hosted server)

**Status:** build-ready. Produced by the wayfinding map [Map: Hosted Rouvy MCP server — milestone 2 (web auth)](https://github.com/scastiel/rouvymcp/issues/28).
Each section links the tickets its decisions come from; the tickets hold the reasoning. This document is the source of truth: if the build shows a decision is wrong, change it here in the same PR.

M2 builds on [`spec-m1.md`](spec-m1.md). Everything there still holds unless a section here changes it.

Vocabulary is defined in [`GLOSSARY.md`](../GLOSSARY.md): **Activity**, **Activity file**, **Rider settings**, **Activity snapshot**, **Session**, **Grant**, **Public instance**, **Hard stop**. **Session** is always the Rouvy side; **Grant** is the client side. Never mix them up in code, copy or docs.

---

## 1. Scope

A second entry point for the same `createServer()` core: a **Streamable HTTP server on Cloudflare Workers**. Any MCP client can connect to it with spec-compliant MCP OAuth, and it signs the rider in to Rouvy on their behalf. One codebase serves two deployments:

- **the Public instance**: run by the maintainer, **invite-only** (an allow-list), free, $5/month at most;
- **self-hosts**: the same recipe on a rider's own Cloudflare account.

The stdio `npx rouvy-mcp` stays first-class and unchanged, apart from moving to SDK v2 (§7, build step 1).

**Out of scope for M2**

- Opening the Public instance beyond the allow-list: allow-list exit, per-rider abuse limits, a self-serve "Your Grants" page. This is gated on Rouvy's written permission (§10) and would be a fresh effort.
- A Node/Docker HTTP build. Self-hosting uses the Workers recipe; stdio stays the free option.
- A paste-a-token sign-in.
- Social-only Rouvy accounts (no Rouvy password).
- Separate rouvy-mcp user accounts. The rider's Rouvy account (Firebase uid) is the only identity.
- Payments or any paid tier.
- `export_activity_file` on the hosted server.
- Client-specific code or bundles. claude.ai custom connectors are the reference client, through the plain MCP authorization spec only.
- Scopes, and any write to Rouvy.

Sources: [Map](https://github.com/scastiel/rouvymcp/issues/28), [Hosting platform and storage for the hosted server](https://github.com/scastiel/rouvymcp/issues/36), [Client-to-server sign-in flow for the hosted server](https://github.com/scastiel/rouvymcp/issues/34), [Assemble the M2 spec: form, location, and contents](https://github.com/scastiel/rouvymcp/issues/37).

## 2. Ground rules

M1's ground rules ([spec-m1 §2](spec-m1.md#2-ground-rules)) apply unchanged: the politeness charter, the honest UA, no secrets in logs, repo hygiene, read-only by construction. The hosted server adds:

- **Hard stop.** If Rouvy objects to the Public instance or blocks it, the instance shuts down and every Grant is deleted within 24 hours (§9). We never rotate IPs, disguise the UA or move hosts to get around a block.
- **No Activity data at rest.** Activity data lives only in memory caches. The one thing kept per rider is the Rouvy refresh token, encrypted inside the Grant (§6).
- **Consent first.** No Grant exists without the two checkboxes on the sign-in page (§5).
- **Honest identification.** Requests come from our own Cloudflare zone (the `CF-Worker` header) with the honest UA. We make ourselves easy to recognise and easy to block.
- **Never logged** (on top of M1's list): `props`, emails, IP addresses, uids (§9).

Sources: [Operator risk for a public instance: Rouvy ToS, GDPR, official integrations](https://github.com/scastiel/rouvymcp/issues/29), [Hosting platform and storage for the hosted server](https://github.com/scastiel/rouvymcp/issues/36), [Operations for the Public instance](https://github.com/scastiel/rouvymcp/issues/53).

## 3. Architecture

```
MCP client ──► Worker front (workers-oauth-provider)
                 ├── OAuth: metadata, /authorize (our sign-in page), /token, /register
                 ├── /privacy, /health
                 └── POST /mcp (valid token) ──► one Durable Object (EU jurisdiction)
                                                   ├── shared polite layer (global queue, cool-down)
                                                   └── per uid: createServer({ credentials, fetch: politeFetch })
                                                         └── live Session, cookies, M1 caches (in memory)
               KV (OAUTH_KV): clients, Grants (Rouvy refresh token encrypted in props), access tokens
```

- **Platform:** Cloudflare **Workers Paid** (a $5/month ceiling). Tool calls use 57–305 ms of CPU, far over the Free plan's 10 ms limit. Recorded as [ADR 0001: host the web server on Cloudflare Workers](adr/0001-host-on-cloudflare-workers.md).
- **The Worker front** handles OAuth and routing only. It uses `@cloudflare/workers-oauth-provider` (pinned; 1.2.4 at the time of writing) with `clientIdMetadataDocumentEnabled: true`.
- **One Durable Object, in the EU jurisdiction,** acts as "the M1 process":
  - it holds the global politeness state;
  - it runs one `createServer()` per uid (§7);
  - all of it lives in memory. After an eviction it's rebuilt on the next call, as after an M1 restart.
- **Storage:**
  - **KV** holds the provider's records only.
  - The **allow-list** is a Worker secret listing allowed riders' Rouvy emails, edited with `wrangler secret put`.
  - No D1, no Durable Object storage.
- **Compatibility flags:** `nodejs_compat` and `global_fetch_strictly_public` (the latter is required for CIMD).
- **Domain:** the Worker's own workers.dev hostname, `https://rides-mcp.scastiel.workers.dev/mcp`, **without "rouvy" in it** (the maintainer's call at build time, in place of a custom domain). The MCP URL is the OAuth audience and sits in every connector config, so **it never changes once riders have connected**: the Worker's name and the account's workers.dev subdomain are never renamed. Self-hosters may use a custom domain instead (§11).
- **Repo layout:** the hosted code lives in `src/hosted/`, with `wrangler.toml` at the root. It is excluded from the npm package (`files`), which stays stdio-only. It deploys only through `wrangler deploy`. One version number, injected into the Worker at build time.

Sources: [Hosting platform and storage for the hosted server](https://github.com/scastiel/rouvymcp/issues/36), [Probe Rouvy from candidate hosts](https://github.com/scastiel/rouvymcp/issues/33), [OAuth authorization server options for a Rouvy-credential login](https://github.com/scastiel/rouvymcp/issues/31), [Assemble the M2 spec](https://github.com/scastiel/rouvymcp/issues/37).

## 4. MCP endpoint and protocol

- **SDK:** MCP TypeScript SDK **v2** (`@modelcontextprotocol/server`, `~2.4.0`) for both entry points. Minor bumps are deliberate PRs.
- **Protocol revisions:** the SDK's default list on both entry points, with no narrowing:
  - the modern era, `2026-07-28` (`server/discover`, per-request `_meta` envelope);
  - the legacy era, `initialize` from `2025-11-25` back to `2024-10-07`.

  claude.ai tries `server/discover` at `2026-07-28` first and falls back to `initialize` at `2025-11-25` on `-32601`.
- **Transport:** stateless Streamable HTTP. `POST /mcp` only (anything else gets 405), JSON responses, no `Mcp-Session-Id`, no SSE stream.
- **We are the resource server:**
  - any request without a valid token gets **401** + `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/mcp"`. Never a 200 "please sign in": clients only start OAuth on a transport-level 401;
  - every token is checked for expiry and **audience = our canonical MCP URL** (RFC 8707);
  - our tokens are never passed through to Rouvy.

  Either `requireBearerAuth` (with `expectedResource`) or the provider's `apiHandler` performs the check; that's a build detail.
- **We are our own authorization server, and own no SDK auth-server code:**
  - The provider serves RFC 8414 metadata, RFC 9728 protected-resource metadata, S256 PKCE, `iss` (RFC 9207), refresh rotation and `invalid_grant`.
  - We write only three things: the `/authorize` page (§5), the `completeAuthorization` call, and the Durable Object's signal that a Grant must be revoked (§6).
  - `server-legacy/auth` and v1's `mcpAuthRouter` are never imported.
- **Client registration: CIMD and DCR.**
  - **CIMD:** claude.ai uses `https://claude.ai/oauth/mcp-oauth-client-metadata` when CIMD is advertised.
  - **DCR:** the fallback, and needed for Cursor. Public clients are allowed. Registered clients expire after the provider's default 90 days. claude.ai's DCR registers twice; both registrations must work.
- **Redirects:** exact match, port-agnostic on loopback. claude.ai, Desktop and mobile share `https://claude.ai/api/mcp/auth_callback`.
- **Answer `/token` within 10 s** (Claude's timeout).

Sources: [MCP authorization spec and what claude.ai and other clients support](https://github.com/scastiel/rouvymcp/issues/30), [Probe which MCP protocol revision claude.ai negotiates](https://github.com/scastiel/rouvymcp/issues/41), [MCP SDK line for M2: v1 or v2](https://github.com/scastiel/rouvymcp/issues/42), [OAuth authorization server options for a Rouvy-credential login](https://github.com/scastiel/rouvymcp/issues/31).

## 5. Sign-in and Grants

**The sign-in page** is one English page at `/authorize`, built on `parseAuthRequest` → `describeConsent` / `beginConsent` → `completeAuthorization`:

- **Header:** "\<client name\> (\<verified domain\>) wants to read your Rouvy rides", the redirect host, and an "unofficial, not affiliated with Rouvy" line. Every client-supplied string is escaped.
- **Fields:** Rouvy email and Rouvy password.
- **Two separate checkboxes, both required, neither pre-ticked:**
  1. the rider accepts the risk to **their own** Rouvy account under Rouvy's terms (§7.c, §14.a.vi), and the Hard stop;
  2. explicit consent to processing health data (GDPR Art. 9(2)(a)).
- **Links:** `/privacy` and the self-host README.
- **Buttons:** **Connect**, and **Cancel** (`denyConsent` → `access_denied` back to the client).
- **Consent every time:** no remembered consent, since every Grant needs a fresh Rouvy sign-in.

**The allow-list:**

1. It is checked on the **typed email, lowercased, before any Firebase call**, so our page can't be used to test arbitrary passwords against Firebase from our shared egress.
2. It is checked again on the email Firebase returns.
3. A rider not on the list gets an on-page "This instance is invite-only" message with a link to self-hosting, and no redirect.

**On Connect:**

1. M1's `signInWithPassword`.
2. One Rouvy check, as `login` does.
3. `completeAuthorization` with `userId` = Firebase uid and `props` = `{ refreshToken, uid, email }`.
4. The password is discarded.

Firebase errors show M1's plain messages, never Firebase response bodies.

**Tokens and lifetimes:**

- **No scopes.** `scopesSupported` and `requiredScopes` are unset.
- **Access tokens:** 1 h (the provider default).
- **Refresh tokens:** rotated, with a **30-day idle lifetime** (`refreshTokenIdleTTL`) and no hard cap. A Grant in use lives on; one unused for 30 days is deleted.

**Disconnecting** (no self-serve page in M2). The privacy notice lists three ways:

- remove the connector in the client: immediate if the client revokes, otherwise the Grant idles out within 30 days;
- change the Rouvy password, which ends every Grant through Firebase;
- ask the maintainer (the kill path, §6).

Sources: [Client-to-server sign-in flow for the hosted server](https://github.com/scastiel/rouvymcp/issues/34), [Operator risk for a public instance](https://github.com/scastiel/rouvymcp/issues/29).

## 6. Token custody and Sessions

**Custody:**

- The **Rouvy refresh token lives only in the Grant's `props`**, which the provider encrypts with a per-grant key wrapped by each token.
- There is no server-side table and no key of ours, so there is nothing to rotate or leak.
- A KV dump alone reveals nothing. The server can only use a rider's token while serving one of that rider's requests, so background access is impossible by construction.
- Self-host is identical.

**Renewal, lazily in the Durable Object:**

- Each `/mcp` request hands the Grant's `props` to the Durable Object.
- The Durable Object renews with M1's `renewSession`, unchanged: a securetoken refresh, then `auth.data`. It does this only when it has no live Session for that uid, or the idToken is within 5 minutes of expiry.
- `tokenExchangeCallback` is **not** used.
- If Firebase ever rotates a refresh token, the new one stays in the Durable Object's memory, not in `props`. A rotation counter is logged so we notice (§9).

**What ends a Grant:**

- **Only terminal Firebase answers** during renewal: `INVALID_REFRESH_TOKEN`, `TOKEN_EXPIRED`, `USER_NOT_FOUND`, `USER_DISABLED`.
  1. The Durable Object signals the Worker.
  2. The Worker `revokeGrant`s that Grant. The grant id comes from the presented token (`{userId}:{grantId}:{secret}`, or `unwrapToken`).
  3. The Worker answers **401**. The client's refresh gets `invalid_grant`, and the rider is back on the sign-in page.
  4. The rider's other Grants meet the same answer on their own next call.
- **Transient failures don't end it:** network errors, 5xx, `TOO_MANY_ATTEMPTS`, and **Rouvy refusing `auth.data` despite a fresh idToken**. They return a "try again later" tool error. A Rouvy refusal is a block signal (§9), not the rider's fault.

**Kill paths:**

- **Kill one rider** (also how GDPR erasure is done):
  1. Remove their email from the allow-list secret.
  2. `wrangler kv` prefix-delete `grant:{uid}:` and `token:{uid}:`.
  3. Their next request gets 401. Their in-memory Session is gone within the 30-minute idle drop (§7).

  There is **no admin route** on the Worker.
- **Hard stop:** delete the KV namespace and the Worker (§9).

Sources: [Rouvy token custody on the hosted server](https://github.com/scastiel/rouvymcp/issues/35), [OAuth authorization server options for a Rouvy-credential login](https://github.com/scastiel/rouvymcp/issues/31).

## 7. Core changes

Changes to the shared core and to stdio, so that one `createServer()` serves both entry points:

1. **SDK v2 migration first, on its own.** Swap the five v1 imports:
   - `McpServer` and `CallToolResult` move to `@modelcontextprotocol/server`;
   - the bin serves through `serveStdio(() => createServer(...))` from `@modelcontextprotocol/server/stdio`, not a hand-wired `StdioServerTransport`: only `serveStdio` answers `server/discover` (a hand-wired instance answers `-32601`);
   - tool input schemas are wrapped in `z.object(...)`: v2 deprecates raw shapes;
   - in tests, `InMemoryTransport` and `Client` move to `@modelcontextprotocol/client`.

   Check the stdio `bin` against Claude Desktop and Claude Code, then release **`0.2.0`** before any hosted code lands.
2. **Injected polite fetch.** `createServer()` accepts an optional polite fetch (queue + cool-down) and builds its own only when none is given, so stdio is unchanged. The Durable Object builds **one** and passes it to every rider's instance.
3. **Per-rider instances in the Durable Object:**
   - one `createServer()` per uid, keyed in a map;
   - each instance gets an in-memory `credentials` provider. `load()` returns the latest `props` seen for that uid, and `save()` keeps a rotated token in memory;
   - an instance (live Session, cookies, M1's caches) is dropped after **30 minutes idle**, when its Grant is revoked, and on eviction.
4. **Version injected at build time.** `src/constants.ts` stops reading `package.json` from disk (it fails at Worker startup). The version is injected for both the npm build and the Worker.
5. **Terminal vs transient auth errors.** M1 maps every `AuthError` to *Not logged in*. The core now reports terminal (§6) and transient failures separately:
   - stdio keeps its current messages;
   - the hosted server turns terminal into Grant revocation + 401, and transient into "try again later".
6. **Hosted error copy.** Nothing on the hosted server ever says `npx -y rouvy-mcp login`. Where a rider must act, the copy says to **reconnect** in their client.
7. **No `export_activity_file`** on the hosted server: `storage` is unset, so the tool isn't registered.

M1's other error kinds ([spec-m1 §8](spec-m1.md#8-errors)) carry over unchanged.

Sources: [MCP SDK line for M2: v1 or v2](https://github.com/scastiel/rouvymcp/issues/42), [Rouvy token custody on the hosted server](https://github.com/scastiel/rouvymcp/issues/35), [Probe Rouvy from candidate hosts](https://github.com/scastiel/rouvymcp/issues/33).

## 8. Politeness at scale

- **M1's request budget ([spec-m1 §7](spec-m1.md#7-politeness-and-caching)) applies globally**, to the whole instance:
  - one FIFO queue;
  - at least 1 s between requests;
  - the Cloudflare/429 cool-down, shared by all riders.
- **Fairness:** at most **one tool call in flight per rider**; a rider's extra calls wait their turn. No per-rider quotas while invite-only.
- **Caches** stay M1's, keyed by uid, in memory only, dropped with the rider's instance.
- **A block on the shared egress hits every rider at once.** It is the Hard stop tripwire (§9).

Sources: [Assemble the M2 spec](https://github.com/scastiel/rouvymcp/issues/37), [Hosting platform and storage for the hosted server](https://github.com/scastiel/rouvymcp/issues/36).

## 9. Operations

**Logging:**

- Workers Logs only, kept 7 days. No Logpush, no third-party sink.
- **Automatic invocation logs are off.** Only our own structured events are logged:
  - tool name and outcome category;
  - duration;
  - Rouvy and Firebase status codes;
  - cool-downs and block signals;
  - Grant created, revoked, or revoked on a terminal error;
  - the refresh-token rotation counter;
  - Durable Object evictions.
- **Never logged:** M1's list, `props`, emails, IP addresses, uids. Support matches a rider's report by timestamp.

**Monitoring:**

- **`GET /health`** runs M1's account-free canary checks ([spec-m1 §9](spec-m1.md#9-testing-and-drift-detection)) **from the Worker's own egress**, cached so Rouvy sees them at most once an hour. It also reports the Durable Object's block-signal counts for the last 24 h. No personal data.
- **The existing daily canary workflow also calls `/health`**, and opens or comments on its issue when either side fails.
- **No automated authenticated check:** no Rouvy token or Grant in CI. The maintainer's own use of their connector is the end-to-end check.

**Block or drift:**

- **It's a block, so Hard stop,** when either:
  - the Worker-side checks fail while the GitHub-side checks pass, or
  - the Durable Object's hard block signals persist for over 1 h. Those signals are a Cloudflare 403 or challenge, or Rouvy refusing `auth.data` despite a fresh idToken.
- **Both sides fail: it's Rouvy drift.** Fix it as in M1. The instance stays up, with tools returning errors meanwhile.
- **Any objection from Rouvy,** through any channel: Hard stop.
- **429s and short cool-downs** are normal politeness, not a block.

**Hard-stop runbook** (within 24 h, maintainer alone):

1. Turn the sign-in page into a "closed" notice (one redeploy) and add a line to the README.
2. Email the invited riders. The maintainer keeps a private copy of the invite list outside the Worker for this.
3. Delete the KV namespace, which removes every Grant and token.
4. Delete the Worker and its Durable Object.
5. If Rouvy objected, reply to them confirming it's done.

Stdio and self-host are unaffected.

**Suspected token leak:**

1. Delete the KV namespace right away; every Grant dies.
2. Redeploy with a fresh namespace.
3. Email riders advising a Rouvy password change, which kills any leaked Firebase refresh token.
4. Assess breach notification within 72 h: GDPR Art. 33, and the CAI under Law 25 when there's a risk of serious injury (§10).

**Firebase or Rouvy outages** need no runbook: transient tool errors, and no retries beyond M1's.

Sources: [Operations for the Public instance](https://github.com/scastiel/rouvymcp/issues/53).

## 10. Legal, GDPR and Rouvy

Not legal advice. Verdict: **amber** for an invite-only, free, small, honest Public instance.

**Applicable law:**

- **The operator is established in Québec.** GDPR applies through Art. 3(2), since the instance offers a service to riders in the EU; the UK GDPR applies the same way for UK riders.
- **Art. 27 (EU representative):** we rely on the Art. 27(2) exemption (small, invite-only, low risk), with the reasoning written into the Art. 30 record.
  - **Known weakness:** a service that runs all the time could be read as "regular", not occasional.
  - **Revisit trigger:** if the instance grows, or any authority asks, appoint a representative (EU, and UK for UK riders).
- **Québec Law 25:** complied with through the same paperwork:
  - the maintainer is named **person in charge of protecting personal information**;
  - the DPIA doubles as the s. 17 assessment for data leaving Québec;
  - the breach log doubles as the confidentiality-incident register.
- **PIPEDA:** no paperwork; the instance is non-commercial.

**Pages the Worker serves:**

- **`/privacy`: the Art. 13 notice.** Sections:
  1. the controller and a contact address used only for this instance;
  2. the person in charge under Law 25;
  3. the purpose: reading your own rides for your MCP client;
  4. the legal basis: Art. 6(1)(a) consent plus Art. 9(2)(a) explicit consent;
  5. recipients: Cloudflare as processor, with Rouvy named as the source;
  6. location: the Durable Object in the EU, KV global with tokens encrypted;
  7. retention: Grants deleted after 30 days idle, logs kept 7 days, in-memory caches dropped after 30 minutes idle, no Activity data at rest;
  8. rights: withdrawing consent means disconnecting (§5's three routes); erasure on request (§6's kill path);
  9. complaints: the rider's own data-protection authority, or the CAI;
  10. no automated decisions;
  11. the Hard stop;
  12. the Data Act line (below).
- **`/authorize`:** the two checkbox texts and the "unofficial" line (§5).
- **No terms-of-service page.**

**Paperwork before the beta:**

- **Art. 30 record of processing:** public, in `docs/legal/`. It includes the Art. 27 reasoning, Cloudflare as processor, and a representative if one is ever appointed.
- **A short DPIA:** public, in `docs/legal/`. It is also the Law 25 s. 17 assessment. Scope: credential handover, token custody, egress to Rouvy, with the Hard stop as mitigation.
- **Cloudflare's DPA:** accepted on the account.
- **Breach log (Art. 33(5)):** private, kept by the maintainer. It is also the Law 25 incident register.

This spec fixes the pages, the notice sections, the checkboxes and the paperwork list. The final wording is drafted at build step 8.

**EU Data Act:**

- Ride telemetry is plausibly covered, but the Act doesn't justify the private-API route.
- Whether a free operator is a "data recipient" (Art. 2(14)) is open. We commit to **Art. 6's third-party duties** anyway:
  - ride data used only for the purpose the rider asked for;
  - no profiling, selling or sharing;
  - nothing kept beyond the request;
  - no dark patterns in consent.

  The notice says so in one line.

**Rouvy permission request** (outline; the email is written at beta time):

- **When:** as the invite-only beta goes live. The beta doesn't wait for a reply. Leaving the allow-list waits for a written §29.i yes, and silence is never a yes.
- **Who and where:** the maintainer, under their real name, with a link to the repo. The same text goes to a Rouvy help-desk ticket (asking to be forwarded to whoever owns partner or API access) and to one named Rouvy product or business person. One follow-up to both after about **4 weeks**.
- **What it covers:**
  - the request for §29.i written permission;
  - how to recognise us: the honest UA, our zone in `CF-Worker`, read-only access and the politeness charter, encrypted refresh tokens only, no Activity data at rest, the 24 h Hard stop;
  - allow-listing our zone, offered as an optional extra;
  - one cooperative Data Act paragraph offering to be the sanctioned Art. 5 channel.

  No legal threats, and Terra is not mentioned.
- **Outcomes:**
  - **Yes:** the instance may leave the allow-list, in a fresh effort (§1).
  - **Yes with conditions:** conditions we can meet within the charter become operating rules; one we can't counts as a no for what it covers.
  - **No, an objection, or a block:** Hard stop (§9).
  - **Silence:** invite-only indefinitely, still under the Hard stop.

Sources: [Legal pages and GDPR paperwork for the Public instance](https://github.com/scastiel/rouvymcp/issues/54), [Operator risk for a public instance](https://github.com/scastiel/rouvymcp/issues/29), [When and how to ask Rouvy for written permission](https://github.com/scastiel/rouvymcp/issues/39), [EU Data Act as a legal access path to Rouvy ride data](https://github.com/scastiel/rouvymcp/issues/40).

## 11. Self-hosting

A **"Self-host on Cloudflare"** README section, best effort: the same code as the Public instance, no support promise. It covers:

- forking the repo and running `wrangler deploy`;
- Workers Paid ($5/month);
- creating the KV namespace, with the Durable Object in the EU jurisdiction;
- the `nodejs_compat` and `global_fetch_strictly_public` flags;
- the allow-list secret (`wrangler secret put`);
- a URL, on workers.dev or a custom domain, that must **never change once riders have connected**;
- the kill-one-rider and Hard stop commands (§6, §9).

The self-hoster is the operator, with the operator's duties (§10). Stdio `npx rouvy-mcp` stays the zero-cost option.

Sources: [Hosting platform and storage for the hosted server](https://github.com/scastiel/rouvymcp/issues/36), [Assemble the M2 spec](https://github.com/scastiel/rouvymcp/issues/37).

## 12. Testing and drift

- **M1's tests and fixtures carry over** ([spec-m1 §9](spec-m1.md#9-testing-and-drift-detection)), moved to SDK v2's in-memory client/transport pair.
- **Hosted tests run offline**, with fakes for the provider and Firebase:
  - the 401 + `WWW-Authenticate` challenge and the metadata;
  - the allow-list checked before any Firebase call;
  - consent required, and Cancel → `access_denied`;
  - terminal errors → Grant revoked + 401; transient errors → tool error;
  - one shared polite layer across riders, and one call in flight per rider;
  - idle instances dropped;
  - no uid, email, IP, token or `props` in logged events.
- **Drift:** the daily canary also polls `/health` (§9). `npm run contract:live` stays the maintainer's pre-release check over stdio.
- **End to end:** each slice that touches OAuth is checked by connecting a claude.ai custom connector to a deployed instance, as the protocol probe did ([Probe which MCP protocol revision claude.ai negotiates](https://github.com/scastiel/rouvymcp/issues/41)).

Sources: [Operations for the Public instance](https://github.com/scastiel/rouvymcp/issues/53), [Probe which MCP protocol revision claude.ai negotiates](https://github.com/scastiel/rouvymcp/issues/41).

## 13. Build order

Vertical slices, each usable on its own. Turning them into implementation issues is a separate step after this spec.

1. **SDK v2 migration, released as `0.2.0`.** Stdio only (§7.1). No hosted code yet.
2. **Core changes.** The injected polite fetch, the version injected at build time, terminal vs transient auth errors (§7.2, §7.4, §7.5).
3. **Worker skeleton.** `wrangler.toml`, the provider, the metadata, `/mcp` forwarded to the Durable Object with per-uid `createServer()` instances. Deployed with a test Grant.
4. **Sign-in.** The `/authorize` page, the allow-list, consent, CIMD + DCR. Connected from claude.ai end to end.
5. **Custody.** Lazy renewal, Grant revocation on terminal errors, one call in flight per rider, idle drop, the kill commands.
6. **Operations.** Structured logging with invocation logs off, `/health`, the canary workflow change, the runbooks in the repo.
7. **Self-host README, then deploy the Public instance** on its workers.dev hostname.
8. **Legal pages live, then the beta opens.** `/privacy` and the checkbox wording drafted; the Art. 30 record and DPIA in `docs/legal/`; Cloudflare's DPA accepted. Invite the first riders, then send the Rouvy permission request (§10).

---

## Appendix A: endpoints

| Path | Method | Served by | Notes |
|---|---|---|---|
| `/mcp` | POST | Durable Object, behind the provider's token check | 401 + `WWW-Authenticate` without a valid token; other methods get 405 |
| `/.well-known/oauth-protected-resource` (and `/mcp` suffix) | GET | provider (`resourceMetadata`) | `resource` = the canonical MCP URL; `authorization_servers` = [issuer] |
| `/.well-known/oauth-authorization-server` | GET | provider | S256, `none` auth method, CIMD flag, `registration_endpoint`, `iss` |
| `/authorize` | GET, POST | ours | the sign-in page (§5) |
| `/token` | POST | provider | code + PKCE, rotating refresh, `invalid_grant`, revocation |
| `/register` | POST | provider | DCR, public clients, 90-day expiry |
| `/privacy` | GET | ours | the Art. 13 notice (§10) |
| `/health` | GET | ours | Worker-side canary + 24 h block-signal counts, cached ≤ 1/h (§9) |
