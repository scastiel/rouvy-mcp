# MCP authorization: the spec, real clients, and the TypeScript SDK

Research for [MCP authorization spec and what claude.ai and other clients support](https://github.com/scastiel/rouvymcp/issues/30) (map: [Map: Hosted Rouvy MCP server — milestone 2 (web auth)](https://github.com/scastiel/rouvymcp/issues/28)).
Researched 2026-10-25. Every claim links to the source that owns it. SDK claims cite files in this repo's `node_modules` (`@modelcontextprotocol/sdk` **1.32.2**, published 2026-10-23) or the v2 package `@modelcontextprotocol/server` **2.4.0** (inspected from its npm tarball).

Terms: "client" is the MCP client (claude.ai, ChatGPT, …). "Session" keeps its `GLOSSARY.md` meaning (our server's logged-in connection to Rouvy). This note calls the client-side grant an **access grant** for lack of a settled term; see the last section.

## TL;DR

- **Latest spec is `2026-07-28`.** Our server is an OAuth 2.1 **resource server** that MUST serve RFC 9728 Protected Resource Metadata and MUST validate token audience. Since we have no third-party identity provider (Rouvy has no OAuth), **we are also the authorization server**, so we must serve RFC 8414 metadata, `/authorize` with S256 PKCE, `/token` (authorization_code + refresh_token, form-encoded), and some way for clients to get a `client_id`.
- **Client registration:** the spec now says AS **SHOULD** support **CIMD** (Client ID Metadata Documents) and **deprecates DCR** (kept for backwards compatibility). claude.ai uses CIMD only if AS metadata has `client_id_metadata_document_supported: true` **and** `"none"` in `token_endpoint_auth_methods_supported`, otherwise falls back to DCR. ChatGPT prefers CIMD, accepts DCR. **Cursor documents only DCR** (or a static client ID). Implement **both CIMD and DCR** to cover every client.
- **The 2026-07-28 transport is stateless** (no `initialize`, no `Mcp-Session-Id`). Clients still speaking `2025-11-25` use sessions optionally. Run stateless either way, which fits a horizontally-scaled or serverless host.
- **SDK:** v1 (`@modelcontextprotocol/sdk` 1.32.2, what we use) ships a full Express auth server (`mcpAuthRouter`, `requireBearerAuth`), but tops out at protocol `2025-11-25` and does not advertise CIMD or emit `iss`. v2 (`@modelcontextprotocol/server` 2.x) speaks `2026-07-28` and `2025-11-25`, but ships **only resource-server helpers**; its AS code is "frozen" in `@modelcontextprotocol/server-legacy/auth`. Either way **we write the AS ourselves** (or wrap the frozen one); the SDK gives us PRM, bearer middleware, and the transport.

## 1. What the spec requires (revision 2026-07-28)

Source: [Authorization](https://modelcontextprotocol.io/specification/latest/basic/authorization) (resolves to `2026-07-28`), its sub-pages [Authorization Server Discovery](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery.md), [Client Registration](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration.md), [Security Considerations](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations.md), and the [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog).

Authorization is OPTIONAL. When used over HTTP it SHOULD conform. stdio SHOULD NOT use it (so M1's stdio path is untouched).

### Roles

- MCP server = OAuth 2.1 resource server (RS). MCP client = OAuth 2.1 client. The AS "may be hosted with the resource server or a separate entity". We co-host it.

### Discovery

- RS **MUST** implement RFC 9728 PRM, and the document **MUST** list ≥1 entry in `authorization_servers`.
- RS **MUST** expose PRM by at least one of: `resource_metadata="…"` in the `WWW-Authenticate` header of a `401`, or a well-known URI (path-inserted `/.well-known/oauth-protected-resource/<mcp-path>`, or root `/.well-known/oauth-protected-resource`). Clients try the header first, then path-inserted, then root.
- AS **MUST** provide RFC 8414 metadata or OIDC Discovery. For an issuer without a path, clients try `/.well-known/oauth-authorization-server` then `/.well-known/openid-configuration`. The `issuer` in the document **MUST** be identical to the issuer used to build the URL, or the client rejects it.

### Client registration (priority order for clients)

1. Pre-registered client, 2. **CIMD** if AS metadata has `client_id_metadata_document_supported`, 3. **DCR** if `registration_endpoint` exists, 4. ask the user.

- CIMD: `client_id` is an HTTPS URL with a path; the AS SHOULD fetch it, **MUST** check the document's `client_id` equals the URL, **MUST** validate `redirect_uri` against the document, SHOULD cache per HTTP headers, SHOULD guard against SSRF, **MUST** clearly show the redirect URI hostname on consent, SHOULD warn for localhost-only redirect URIs. Draft: [draft-ietf-oauth-client-id-metadata-document-00](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-client-id-metadata-document-00).
- DCR ([RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591)): "**deprecated** and retained for backwards compatibility" (changelog, deprecated item 4, [PR #2858](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2858)); AS and clients **MAY** support it. Under the feature-lifecycle policy a deprecated feature stays for at least twelve months.

### Authorization request and PKCE

- AS **MUST** implement OAuth 2.1 ([draft-ietf-oauth-v2-1-13](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-13)). Clients **MUST** use PKCE with `S256` and **MUST refuse to proceed** if `code_challenge_methods_supported` is absent from AS metadata.
- Clients **MUST** send `resource` ([RFC 8707](https://www.rfc-editor.org/rfc/rfc8707.html)) on both the authorization and token requests, set to the server's canonical URI (lowercase scheme/host, no fragment, SHOULD have no trailing slash), "regardless of whether authorization servers support it".
- New in 2026-07-28 ([SEP-2468](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2468)): AS **SHOULD** return `iss` in authorization responses, including errors ([RFC 9207](https://datatracker.ietf.org/doc/html/rfc9207)), and if it does **MUST** advertise `authorization_response_iss_parameter_supported: true`. Expected to become MUST in a later revision.
- Redirect URIs **MUST** be `localhost` or HTTPS. AS **MUST** validate exact redirect URIs against registered values. All AS endpoints **MUST** be HTTPS.

### Using and validating tokens

- `Authorization: Bearer …` on **every** HTTP request; never in the query string.
- RS **MUST** validate tokens per OAuth 2.1 §5.2 and **MUST** check the token was issued for it (audience). Invalid or expired token → **`401`**. RS **MUST NOT** accept or pass through any other token. (For us: the client's token never goes to Rouvy, and Rouvy's token never goes to the client.)
- Insufficient scope → SHOULD be `403` with `WWW-Authenticate: Bearer error="insufficient_scope", scope="…", resource_metadata="…"` (step-up flow). RS SHOULD put a `scope` in the `401` challenge; otherwise clients request PRM `scopes_supported`.
- Refresh tokens: clients MUST NOT assume they get one. RS SHOULD NOT list `offline_access` in PRM or the challenge. AS SHOULD issue short-lived access tokens and, **for public clients, MUST rotate refresh tokens** (OAuth 2.1 §4.3.1). CIMD and DCR clients from Claude are public clients.
- Error status codes: `401` (no/invalid token), `403` (scope), `400` (malformed).

### How a client re-auths

Any `401` (missing, expired, revoked token) restarts the dance: client reads `resource_metadata` from the header → PRM → AS metadata → (refresh if it holds a refresh token, else) a full authorization code flow in the browser. A dead refresh token at `/token` must answer `invalid_grant` so the client knows to start over.

### Transport changes that matter for hosting

The [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog) removes protocol-level sessions and `Mcp-Session-Id` ([SEP-2567](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2567)), removes the `initialize` handshake (version and capabilities ride in each request's `_meta`), adds a mandatory `server/discover` RPC, replaces the GET stream with `subscriptions/listen`, removes SSE resumability, and requires `Mcp-Method`/`Mcp-Name` request headers ([SEP-2575](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2575), [SEP-2243](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2243)). A server that wants to serve both eras needs an SDK that does both (v2, below).

## 2. Client support matrix

| | claude.ai / Desktop / mobile / Cowork | Claude Code | ChatGPT | Cursor (desktop) | Cursor (web / Cloud Agents) |
|---|---|---|---|---|---|
| Discovery | `401` + `resource_metadata` required; falls back to probing well-known paths. Uses **only the first** `authorization_servers` entry | PRM then RFC 8414; honours `WWW-Authenticate` | `401` + `resource_metadata`; PRM `resource` / AS `issuer` must match exactly | PRM (RFC 9728) | same |
| CIMD | Yes, only if `client_id_metadata_document_supported: true` **and** `none` in `token_endpoint_auth_methods_supported` | Yes. `client_id` = `https://claude.ai/oauth/claude-code-client-metadata` | **Preferred.** `https://chatgpt.com/oauth/client.json` (or a per-callback-id variant) | Not documented | Not documented |
| DCR | Yes (fallback); one new client per fresh connection | Yes | Yes, once per connection | Yes, as public client (forum: re-registers on reconnect) | Yes |
| Static client ID | Custom-connector dialog: client ID, optional secret | `--client-id` / `--client-secret` / `--callback-port` | "Predefined OAuth clients" (undocumented) | `auth.CLIENT_ID` in config | same |
| Redirect URI | `https://claude.ai/api/mcp/auth_callback` (may become `https://claude.com/api/mcp/auth_callback`) | `http://localhost:<any port>/callback` and `http://127.0.0.1:<any port>/callback` | `https://chatgpt.com/connector_platform_oauth_redirect` (if `iss` compliant) or `https://chatgpt.com/connector/oauth/{callback_id}` | `http://localhost:8787/callback` | `https://www.cursor.com/agents/mcp/oauth/callback` |
| PKCE S256 | Always | Always | Always; S256 must be advertised | Always | Always |
| `resource` param | Sent (canonical URL incl. path) | Sent | Sent; AS should put it in `aud` | Sent | Sent |
| Scopes | `401` `scope` param, else PRM `scopes_supported`; appends `offline_access` if AS lists it | Same + config override | Uses `scopes_supported`; requests advertised OIDC scopes by default | `auth.scopes` or AS `scopes_supported` | same |
| `iss` (RFC 9207) | Not documented | Not documented | Required for the stable redirect URI | Not documented | — |
| Token expiry / revocation | Refreshes on `401` and up to 5 min before expiry; needs `invalid_grant` on dead refresh | On `401`: refresh, reconnect, retry once; dead refresh → "Re-authenticate" in `/mcp` | "treat missing or stale tokens as unauthenticated" | Refreshes; no refresh token → sign in again | Separate sign-in from desktop |
| Quirks | Ignores `WWW-Authenticate` on `200`; tool-level `isError` never triggers sign-in; 10 s timeout on discovery/registration/token, 30 s on refresh; caches discovery ~5 min per URL; drops `Authorization` on cross-host redirect; IPv4-only, egress `160.79.104.0/21`; `client_credentials` unsupported | `claude -p` cannot run the flow | Per-tool `securitySchemes` + `_meta["mcp/www_authenticate"]` for tool-level linking; presents an mTLS client cert | `cursor://` scheme reported in older versions | — |

Sources: Claude: [Authentication for connectors](https://claude.com/docs/connectors/building/authentication.md), [Lazy authentication](https://claude.com/docs/connectors/building/lazy-authentication.md), [Troubleshoot your connector](https://claude.com/docs/connectors/building/troubleshooting.md), [Help Center: custom connectors](https://support.claude.com/en/articles/11503834). Claude Code: [MCP docs](https://code.claude.com/docs/en/mcp), and its CIMD document fetched live from <https://claude.ai/oauth/claude-code-client-metadata> (`redirect_uris: ["http://localhost/callback","http://127.0.0.1/callback"]`, `grant_types: ["authorization_code","refresh_token"]`, `token_endpoint_auth_method: "none"`). ChatGPT: [Apps SDK: Authentication](https://developers.openai.com/apps-sdk/build/auth). Cursor: [Cursor docs: MCP](https://cursor.com/docs/context/mcp); DCR re-registration bug from a [Cursor forum report](https://forum.cursor.com/t/mcp-oauth-persist-dcr-client-id-across-reconnects-avoid-as-side-registration-spam/158226) (user report, unverified).

Not found in primary sources: the CIMD `client_id` URL for the hosted Claude apps (the docs say Anthropic hosts one; we accept any HTTPS `client_id` anyway), and which MCP protocol revision claude.ai speaks today (Claude's docs still link `2025-11-25`; its sample server is a stateless v1 SDK server).

### Shared consequences for us

- All Claude surfaces share one OAuth stack, so "works with claude.ai" covers Desktop, mobile and Cowork; Claude Code differs only in using loopback redirects.
- Loopback redirect matching must ignore the port for `localhost`, `127.0.0.1` and `[::1]` (RFC 8252 §7.3, plus `localhost` for Claude Code).
- If the public instance is invite-only, the allow-list is enforced on **our sign-in page** (by Rouvy account), not by restricting clients. Restricting `client_id`s would break DCR clients, whose IDs are random.

## 3. The MCP TypeScript SDK

### v1: `@modelcontextprotocol/sdk` 1.32.2 (installed)

`LATEST_PROTOCOL_VERSION = '2025-11-25'`, supported back to `2024-10-07` (`dist/esm/types.js`). No `2026-07-28`, no `server/discover`.

Auth server pieces (`dist/esm/server/auth/`), Express 5 only:

- **`mcpAuthRouter({ provider, issuerUrl, baseUrl?, resourceServerUrl?, scopesSupported?, resourceName? })`** (`router.js`): mounts `/authorize`, `/token`, `/register` (if `clientsStore.registerClient` exists), `/revoke` (if `provider.revokeToken` exists), `/.well-known/oauth-authorization-server` and the path-inserted `/.well-known/oauth-protected-resource<path>`. Must be mounted at the app root. Issuer must be HTTPS (localhost exempt, or `MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL`). Rate-limited by default (authorize 100 / 15 min, register 20 / h per IP).
- AS metadata it generates (`createOAuthMetadata`) is **fixed**: `response_types_supported: ["code"]`, `code_challenge_methods_supported: ["S256"]`, `token_endpoint_auth_methods_supported: ["client_secret_post","none"]`, `grant_types_supported: ["authorization_code","refresh_token"]`. It has **no `client_id_metadata_document_supported` and no `authorization_response_iss_parameter_supported`**, so claude.ai and ChatGPT would use DCR, and ChatGPT would use the callback-id redirect. To advertise CIMD we would serve our own AS metadata document instead of the router's.
- **`OAuthServerProvider`** (`provider.d.ts`), what we implement: `clientsStore.getClient(id)` / `registerClient?()`, `authorize(client, {state, scopes, codeChallenge, redirectUri, resource}, res)` (we render or redirect to our Rouvy sign-in page, then redirect with `code`; we can add `iss` ourselves here), `challengeForAuthorizationCode`, `exchangeAuthorizationCode(..., resource)`, `exchangeRefreshToken(..., resource)`, `verifyAccessToken`, `revokeToken?`.
- **CIMD is possible through the store**: `authorize.js` and `clientAuth.js` only call `clientsStore.getClient(client_id)`, so a `getClient` that recognises an HTTPS `client_id`, fetches and validates the document, and returns it as `OAuthClientInformationFull` makes CIMD work. SSRF guarding and caching are ours.
- `authorize.js` enforces `response_type=code`, `code_challenge_method=S256`, validates `redirect_uri` with exact match except port-agnostic loopback (`localhost`, `127.0.0.1`, `[::1]`; `redirectUriMatches`). Pre-redirect errors are `400` JSON; later ones redirect with `error`. It passes `resource` through but **does not check it**; binding the token to our URL is the provider's job.
- `token.js` verifies PKCE locally (`pkce-challenge`) unless `skipLocalPkceValidation`. `clientAuth.js` supports `client_secret_post` and public clients, **not `client_secret_basic`**. Refresh rotation is up to our `exchangeRefreshToken`.
- `register.js` (DCR): accepts RFC 7591 JSON, generates a UUID `client_id`, a secret (30-day expiry) unless `token_endpoint_auth_method: "none"`, CORS open.
- **`ProxyOAuthServerProvider`** (`providers/proxyProvider.d.ts`) forwards to an upstream OAuth server. **Not useful to us**: Rouvy has no OAuth server.
- **`requireBearerAuth({ verifier, requiredScopes?, resourceMetadataUrl?, expectedResource? })`** (`middleware/bearerAuth.js`): `401` with `WWW-Authenticate: Bearer error=…, resource_metadata=…` for missing/invalid/expired tokens and tokens without `expiresAt`; `403 insufficient_scope`; with `expectedResource` it rejects tokens whose `AuthInfo.resource` differs (fragment and one trailing slash ignored). Sets `req.auth`.
- `mcpAuthMetadataRouter` serves PRM + AS metadata when the AS is elsewhere. `getOAuthProtectedResourceMetadataUrl(url)` builds the path-inserted URL.

Transport (`dist/esm/server/streamableHttp.d.ts`, `webStandardStreamableHttp.d.ts`):

- `StreamableHTTPServerTransport` (Node) wraps `WebStandardStreamableHTTPServerTransport` (Workers, Deno, Bun, Hono).
- **Stateful** (`sessionIdGenerator: () => uuid`): session id in headers, unknown id → `404`, missing id → `400`, state held **in memory** (so sticky routing or a single instance).
- **Stateless** (`sessionIdGenerator: undefined`): no session header, no validation, and "Stateless transport cannot be reused across requests. Create a new transport per request" (`webStandardStreamableHttp.js`). Pattern: new `McpServer` + transport per request. This is what Claude's own sample uses.
- Options: `enableJsonResponse`, `eventStore` (resumability), `allowedHosts` / `allowedOrigins` / `enableDnsRebindingProtection`, `maxRequestBodySize` (4 MiB).
- `handleRequest(req, res, parsedBody)` takes `authInfo` (from `req.auth`); tool handlers receive it as `extra.authInfo` (`shared/protocol.d.ts`). That is how a tool call learns which rider it serves, which maps onto `createServer({ credentials })`: build a per-rider credentials provider from `authInfo` per request.
- `createMcpExpressApp({ host, allowedHosts })` (`server/express.d.ts`) adds Host-header validation for localhost; behind a public hostname pass `allowedHosts`.

### v2: `@modelcontextprotocol/server` 2.4.0 (+ `@modelcontextprotocol/express` 2.0.2)

- Ships `2026-07-28` and `2025-11-25` (protocol strings in `dist/*.mjs`; `server/discover`, `subscriptions/listen`, MRTR types exported from `dist/index.d.mts`).
- `createMcpHandler(factory)` returns `{ fetch, … }`, builds a fresh `McpServer` per request, keeps no state between requests, and "serves 2025-era clients statelessly from the same factory by default" ([Serving over HTTP](https://ts.sdk.modelcontextprotocol.io/v2/serving/http)).
- Auth is **resource-server only**: `requireBearerAuth`, `verifyBearerToken`, `bearerAuthChallengeResponse`, `requireScopes`/scope challenges, `buildOAuthProtectedResourceMetadata`, `oauthMetadataResponse`, `getOAuthProtectedResourceMetadataUrl` (all runtime-neutral, `Request` → `Response`). The handler "never reads [`authInfo`] from headers and never verifies a token"; we gate before it.
- The v1 AS helpers (`mcpAuthRouter`, `ProxyOAuthServerProvider`, the handlers) "are frozen in `@modelcontextprotocol/server-legacy/auth`", and the guide says "Use a dedicated identity provider for new servers" ([Authorization](https://ts.sdk.modelcontextprotocol.io/v2/serving/authorization)). It does not mention CIMD.
- Caveat in the same guide: `@modelcontextprotocol/express` 2.0.1 did not forward `expectedResource`; upgrade it together with `server`.

## 4. Minimum our server must implement

For a single public origin, e.g. MCP endpoint `https://mcp.example.org/mcp`, issuer `https://mcp.example.org` (co-hosted AS):

**Resource server**

1. `POST /mcp` (Streamable HTTP, stateless). Every request without a valid token → `401` with `WWW-Authenticate: Bearer resource_metadata="https://mcp.example.org/.well-known/oauth-protected-resource/mcp"` (plus `scope=` once we define one). Never answer "not signed in" as a `200` tool error, because that never triggers sign-in in Claude.
2. Validate every access token: signature or lookup, `exp`, and **audience = our canonical MCP URL** (`expectedResource`). Reject anything else with `401`.
3. `GET /.well-known/oauth-protected-resource/mcp` (and the root form too, cheap insurance): `{ resource: "https://mcp.example.org/mcp", authorization_servers: ["https://mcp.example.org"], scopes_supported?, bearer_methods_supported: ["header"] }`. `resource` must equal the URL the rider types into Claude exactly. No redirects on the MCP URL.

**Authorization server**

4. `GET /.well-known/oauth-authorization-server`: `issuer` (identical to the PRM entry), `authorization_endpoint`, `token_endpoint`, `registration_endpoint`, `response_types_supported: ["code"]`, `grant_types_supported: ["authorization_code","refresh_token"]`, `code_challenge_methods_supported: ["S256"]`, `token_endpoint_auth_methods_supported` including `"none"`, `client_id_metadata_document_supported: true`, and `authorization_response_iss_parameter_supported: true` if we emit `iss`.
5. `GET /authorize`: resolve the client (CIMD fetch for HTTPS `client_id`s, else DCR store), exact `redirect_uri` match with port-agnostic loopback, require S256 `code_challenge`, record `resource` and `state`, show our page (Rouvy sign-in + consent naming the client's host and the redirect host; the allow-list check goes here), then redirect with `code`, `state` and `iss`. Codes single-use and short-lived.
6. `POST /token` (form-urlencoded): `authorization_code` with PKCE verification and the same `redirect_uri`/`resource`; `refresh_token` with **rotation** (new refresh token in the same response); dead or revoked refresh → `invalid_grant`. Access tokens short-lived, `aud` = our MCP URL. Respond well under 10 s.
7. `POST /register` (DCR, deprecated but needed for Cursor and as Claude's fallback): public clients; validate redirect URIs (HTTPS or loopback). Rate-limit, and expect many registrations.
8. Optional: `/revoke` (RFC 7009) so a rider can disconnect; RFC 9207 `iss` (SHOULD now, and ChatGPT's stable redirect needs it).

**Re-auth story** (the map's "Re-auth UX" open question): if the Rouvy refresh token we hold for a rider dies, invalidate the rider's access grant so their next MCP request gets `401`; their client then refreshes, gets `invalid_grant`, and runs the full flow again, which brings the rider back to our Rouvy sign-in page. Claude shows a reconnect prompt; Claude Code points to `/mcp`.

**SDK coverage**

| Need | v1 1.32.2 | v2 2.4.0 |
|---|---|---|
| Streamable HTTP, stateless | Yes (`2025-11-25` max) | Yes (`2026-07-28` + `2025-11-25`) |
| PRM + 401 challenge + audience check | Yes (`mcpAuthMetadataRouter`/`mcpAuthRouter`, `requireBearerAuth` with `expectedResource`) | Yes (runtime-neutral helpers) |
| `/authorize`, `/token`, `/register`, `/revoke`, AS metadata | Yes, via `mcpAuthRouter` + our `OAuthServerProvider` | Only via frozen `@modelcontextprotocol/server-legacy/auth` |
| CIMD | Possible in our `clientsStore.getClient`, but metadata must be served by us to add the flag | Not provided |
| `iss` in auth response | Ours to add in `provider.authorize` | Not provided |
| Token storage, rotation, rider identity, sign-in page | Ours | Ours |

## Questions this surfaced

- **Which SDK line to build M2 on.** v1 has the AS router but not the new protocol; v2 has the protocol but no AS. Upgrading also affects the stdio `bin`. Belongs to [Client-to-server sign-in flow for the hosted server](https://github.com/scastiel/rouvymcp/issues/34) or a new ticket.
- **Build the AS in-process or use an off-the-shelf AS** (with a custom Rouvy-credential login step): this is [OAuth authorization server options for a Rouvy-credential login](https://github.com/scastiel/rouvymcp/issues/31). This note only fixes what it must expose.
- **Which protocol revision claude.ai speaks today**, to confirm with a probe before choosing the SDK line.
- **Glossary term for the client-side grant** ("access grant" is a placeholder here).
