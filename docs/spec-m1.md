# rouvy-mcp — Milestone 1 spec

**Status:** build-ready. Produced by the wayfinding map [Map: Rouvy MCP server — milestone 1 (Activities data)](https://github.com/scastiel/rouvymcp/issues/1).
Each section links the ticket its decisions come from. This document is the source of truth: if the build shows a decision is wrong, change it here in the same PR.

Vocabulary (**Activity**, **Activity file**, **Rider settings**, **Activity snapshot**, **Session**) is defined in [`GLOSSARY.md`](../GLOSSARY.md). Use those words in code, tool descriptions and docs.

---

## 1. Scope

An unofficial, open-source MCP server that reads a rider's own Rouvy Activities and serves them to any MCP client. M1 is **local-first** and **read-only**:

- list Activities,
- read one Activity's summary,
- analyse its per-second data (splits, windows, downsampled streams), from Rouvy's own Activity file,
- optionally write the Activity file (or a CSV) to a local folder.

**Non-goals for M1**

- A public hosted / multi-user instance. M1 only keeps the door open (§3). Credential custody would conflict with Rouvy's ban on sharing sign-in data.
- Anything beyond Activities: routes, planned workouts, profile/FTP editing, challenges, any write to Rouvy.
- Third-party data paths (intervals.icu API, GDPR export).
- Social-only Rouvy accounts (Google/Apple/Facebook without a Rouvy password). Such users can set a Rouvy password.
- Streamable HTTP transport, Docker, binaries, client-specific bundles or features.
- Automatic interval detection.

Sources: [Map](https://github.com/scastiel/rouvymcp/issues/1), [Rouvy terms of service and reverse-engineering risk](https://github.com/scastiel/rouvymcp/issues/3), [Local auth model](https://github.com/scastiel/rouvymcp/issues/6), [MCP tool surface and raw-data shape](https://github.com/scastiel/rouvymcp/issues/7).

## 2. Ground rules

These apply to every part of the build.

- **Politeness charter.** Call only routes Rouvy's official web app calls. Never get around bot protection (no browser UA, no borrowed UA, no challenge solving). Low concurrency, no polling, no background traffic (§7).
- **Honest user agent** on every request: `rouvy-mcp/<package version> (+https://github.com/scastiel/rouvy-mcp)`. A semver'd UA shaped like this passes Cloudflare. Something in `rouvymcp-recon/0.0` tripped a rule, so keep this shape.
- **Secrets.** Never log or echo passwords, tokens, Activity ids, export URLs or Rouvy response bodies. A failed login response can echo the password back.
- **Repo hygiene.** No Rouvy code or content in the repo (no copied JS bundles, no media). Fixtures are committed only when redacted (§9).
- **Read-only by construction.** The Rouvy client has no method that writes to Rouvy. The only POSTs are the two login/refresh calls in §4.

Sources: [Map Notes](https://github.com/scastiel/rouvymcp/issues/1), [Programmatic login path past Rouvy's Cloudflare](https://github.com/scastiel/rouvymcp/issues/9), [Resilience to Rouvy API drift](https://github.com/scastiel/rouvymcp/issues/11).

## 3. Architecture

One npm package, `rouvy-mcp`. No monorepo.

```
bin (stdio)  ──►  createServer({ credentials, storage })  ──►  tools
CLI (login/logout/status)          │
                                   ├── Rouvy client   (HTTP, queue, cool-down, cache, turbo-stream, schemas)
                                   ├── parseActivityFile()   (FIT → our own typed records)
                                   └── stats              (NP, splits, windows, zones, streams)
```

- **`createServer({ credentials, storage })`** is the transport-agnostic core: Rouvy client, FIT parsing, stats and MCP tool registration. It knows nothing about stdio, files or passwords.
  - `credentials`: a provider with only `load(): { refreshToken, uid, email? } | null` and `save(rotated)`. Local M1 uses the file provider (§4). A hosted build would plug in a per-user, DB-backed provider.
  - `storage`: where `export_activity_file` writes (§5.6). Local M1 uses the `ROUVY_MCP_EXPORT_DIR` folder. A hosted build would swap it out or leave it unset.
- **stdio `bin`**: a thin entry point that builds the file-backed providers and connects `createServer()` to the MCP SDK's stdio transport.
- **CLI subcommands** of the same `bin`: `login`, `logout`, `status` (§4). **Password login lives only here, never in the core.**
- **Stack:** TypeScript, Node `>=22`, the official MCP TypeScript SDK, `turbo-stream@^2` (pinned to v2: v3 decodes Rouvy's payloads into junk), `fit-file-parser` (MIT), and a schema library for lenient boundary validation (e.g. zod).

Sources: [Transport and distribution](https://github.com/scastiel/rouvymcp/issues/8), [Local auth model](https://github.com/scastiel/rouvymcp/issues/6), [Parsing Rouvy Activity files in TypeScript](https://github.com/scastiel/rouvymcp/issues/4).

## 4. Auth and CLI

### Login (`npx -y rouvy-mcp login`)

An interactive terminal prompt for email and password (password input hidden), then the same two-step login Rouvy's own sign-in page uses:

1. `POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<ROUVY_FIREBASE_WEB_KEY>` with JSON `{ email, password, returnSecureToken: true }` → `idToken` (1 h), `refreshToken`, `localId` (the uid).
2. `POST https://account.rouvy.com/resources/auth.data`, form-encoded `{ idToken, uid, refreshToken, riders: "true", isNew: "false" }` → 202 turbo-stream redirect plus `Set-Cookie: rouvy_session` (30 days). The CLI makes this call once, to confirm the account works on Rouvy.

Then it saves `{ refreshToken, uid, email }` and prints who is logged in. Firebase error codes become plain messages ("wrong email or password", "too many attempts, try later"). Response bodies are never printed.

`ROUVY_FIREBASE_WEB_KEY` is Rouvy's public Firebase web key (it sits in plain sight in `account.rouvy.com`'s sign-in page). It's **pinned as a constant** and guarded by the daily canary (§9), not scraped at runtime.

**Do not** build on `POST riders.rouvy.com/login.data`. It sits behind a Cloudflare UA rule and an apparent rate rule on login POSTs. At most it's a documented fallback.

### Credentials file

- Contents: `{ refreshToken, uid, email }` as JSON. The password is never stored. The 1 h `idToken` and the 30-day `rouvy_session` live in memory only.
- Location: `$XDG_CONFIG_HOME/rouvy-mcp/credentials.json` (default `~/.config/rouvy-mcp/credentials.json`); `%APPDATA%\rouvy-mcp\credentials.json` on Windows.
- Permissions: file `0600`, directory created `0700`. No OS keychain (no native modules, so `npx` installs stay reliable).
- **Re-read on every call that needs auth**, so a new `login` (even as a different account) takes effect without restarting the MCP client.

### Session refresh (in the server)

- **Lazy, retry once.** Before a call that needs auth, if the in-memory `idToken` is missing or within ~5 min of its JWT `exp`:
  1. `POST https://securetoken.googleapis.com/v1/token?key=<ROUVY_FIREBASE_WEB_KEY>` with `grant_type=refresh_token&refresh_token=…` → new `idToken` (and possibly a rotated `refreshToken`).
  2. `POST account.rouvy.com/resources/auth.data` as above → new `rouvy_session` cookie, kept in memory.
- If a `riders.rouvy.com` call still returns the logged-out signal (HTTP 202 + `SingleFetchRedirect` to `account.rouvy.com/sign-in`), refresh once and retry once.
- If Firebase rotates the refresh token, `credentials.save()` it.
- No background timers. No traffic while idle.

> **Verified 2026-10-24** (build slice 1, [#15](https://github.com/scastiel/rouvymcp/issues/15)): a `securetoken`-refreshed `idToken` is accepted by `resources/auth.data`, which answers with a fresh `rouvy_session` cookie (`rouvy-mcp status` against a real account). The refresh-token design stands. The unused fallback was: store the 30-day `rouvy_session` instead of the refresh token, and have the user re-run `login` about monthly.

### Missing or expired credentials

The server **starts and lists its tools normally**. A tool that needs auth returns the *not logged in* tool error (§8): *"Not logged in to Rouvy (or the login expired). Run `npx -y rouvy-mcp login` in a terminal, then retry."*

### `logout` and `status`

- `logout`: deletes the credentials file. Docs note that Firebase has no client-side revoke: change the Rouvy password for a hard revoke. There's no cache on disk to wipe (§7).
- `status`: prints the email/uid and whether a refresh succeeds. Never prints tokens.

Sources: [Local auth model](https://github.com/scastiel/rouvymcp/issues/6), [Programmatic login path past Rouvy's Cloudflare](https://github.com/scastiel/rouvymcp/issues/9), [Resilience to Rouvy API drift](https://github.com/scastiel/rouvymcp/issues/11).

## 5. MCP tools

Six tools. Every tool takes Activity ids from `list_activities`. Raw per-second rows never go inline (a full per-second CSV is ~340k characters for 80 min). The server computes stats.

Shared conventions:
- `activity_id`: string, an Activity id as returned by `list_activities` (shape `YYMMDDhhmmss-xxxxxxxx`).
- Times inside an Activity (`start_sec`, `end_sec`) are seconds from the start of the Activity file's records.
- Results are JSON text content. Errors are MCP tool errors (`isError: true`) of the kinds in §8.

### 5.1 `list_activities`

- **Input:** `limit` (int, 1–50, default 10; `> 50` is an input error), `offset` (int ≥ 0, default 0).
- **Output:** newest first, compact rows: `id`, `title`, `type` (Rouvy's `training`, e.g. `ROUTE`, `WORKOUT_FTP_TEST`), `start` (`startUTC`, ISO 8601), `moving_time_sec`, `distance_m`, `elevation_m`, `tss`, `if`. Plus whether more rows may exist.
- **Source:** `activities-pagination.data` pages (§6). TSS and IF come from Rouvy's list row.
- Fetches the pages covering `[offset, offset+limit)`: at most **6** upstream pages per call. Stops at the first empty page.

### 5.2 `get_activity`

- **Input:** `activity_id`.
- **Output:** the summary, **Rouvy's numbers as Rouvy gives them** (so they match the Rouvy app):
  - title, type, start, elapsed / moving time, distance, elevation, kcal,
  - `NP`, `IF`, `TSS`, the 7 power peaks (`PP`: 5 s, 30 s, 1 min, 5 min, 20 min, 30 min, 60 min), min/max/avg power, HR, cadence, speed (`aggrs`), %FTP,
  - time in power and HR zones (`hists`), laps, route segment results (`segmentsPasses`),
  - **the Rider settings used**: FTP, weight, max HR, power and HR zones from the Activity snapshot,
  - **available fields**: which data exist (power, HR, cadence…), whether an Activity file exists, and a note for each stat left out and why.
- **Source:** the detail payload. The Activity file only fills what Rouvy doesn't provide. If there's no Activity file, `get_activity` still works and notes "no Activity file".

### 5.3 `get_activity_intervals`

- **Input:** `activity_id`, `every_sec` (int ≥ 10, default 300).
- **Output:** **fixed-size** splits; for each: start/end sec, avg / NP / max power, %FTP, avg/max HR, avg cadence, avg speed, distance, climbing.
- **Source:** the Activity file.

### 5.4 `get_window_stats`

- **Input:** `activity_id`, `start_sec` (int ≥ 0), `end_sec` (int > `start_sec`).
- **Output:** the same stats as one split, for that window, plus efforts inside it: best efforts (peak powers for the durations that fit), first-half vs second-half comparison, climbing, and HR:power drift (decoupling).
- **Source:** the Activity file.

### 5.5 `get_activity_streams`

- **Input:** `activity_id`, `fields` (array of `power`, `heart_rate`, `cadence`, `speed`, `altitude`, `distance`; default `["power", "heart_rate", "cadence"]`), `resolution_sec` (int ≥ 1, default 30), `start_sec?`, `end_sec?`.
- **Output:** downsampled columns (the mean of each bucket), one array per field, plus `resolution_sec_used`.
- **Cap: 500 points per field per call.** If the request would go over it, the server raises the resolution to the smallest value that fits and reports `resolution_sec_used` (not an error).
- **Source:** the Activity file.

### 5.6 `export_activity_file`

- **Opt-in:** registered **only when `ROUVY_MCP_EXPORT_DIR` is set** (an absolute path in the MCP client config's `env`). Unset means the tool doesn't exist, so chat-only clients never see it.
- **Input:** `activity_id`, `format` (`fit` | `csv`, default `csv`).
- **Behaviour:** creates the folder if missing, writes `<activityId>.fit` (the Activity file as downloaded) or `<activityId>.csv` (per-second records) with **0600** permissions, overwrites an existing file, and returns the absolute path. No default folder.
- This is the only thing M1 writes to disk besides the credentials file, and only on explicit request.

### Stats definitions (§5.3–5.5)

- **Rider settings come from the Activity snapshot** (`activity.user.{FTP, weightKg, maxHr, zones{hr[7], pwr[7]}}` in the detail payload): the settings Rouvy stored with that ride. This matches Rouvy's own IF/TSS. No user override, and the current settings (`userData`) are **never** used.
- **Missing values drop stats, with a note.** No HR → no HR stats or HR zones. No power, or FTP missing/0 → no %FTP, IF or zone time. Never a default (no 220-age), never a fallback to current settings.
- **Formulas:** NP = 4th root of the mean of the 4th power of the 30 s rolling average power. Zeros count in average power. %FTP = power / snapshot FTP.
- **One source per number.** Rouvy's numbers cover the whole ride (`get_activity`). Our FIT-derived numbers cover only splits and windows. The two never meet in one result, and the difference is never shown. A test checks that a whole-ride window's NP lands close to Rouvy's NP (§9).

Sources: [MCP tool surface and raw-data shape](https://github.com/scastiel/rouvymcp/issues/7), [Source of Activity summary numbers and rider settings](https://github.com/scastiel/rouvymcp/issues/10), [Politeness and caching](https://github.com/scastiel/rouvymcp/issues/12), [Assemble the M1 spec](https://github.com/scastiel/rouvymcp/issues/13). Prototype tool shapes: branch [`prototype/tool-surface`](https://github.com/scastiel/rouvymcp/tree/prototype/tool-surface).

## 6. Rouvy client

Full redacted endpoint catalog: [Appendix A](#appendix-a-rouvy-web-api).

- **Encoding:** `riders.rouvy.com` is a Remix / React Router 7 app. Each page has a single-fetch data route `<path>.data` returning `text/x-script` in **turbo-stream v2**. Some keys are **deferred** (they arrive later in the same response as promises), so the decoder must await nested promises.
- **Logged-out signal:** HTTP **202** with a `SingleFetchRedirect` to `account.rouvy.com/sign-in`, not 401.
- **Activity list:** `GET /resources/activities-pagination.data?offset=<n>&firebaseUid=<uid>&_routes=routes%2Fresources.activities-pagination`. Session cookie and the user's own uid required. Pages of 10, row `offset`. End of list = empty `activities` array.
- **Activity detail:** `GET /activity/<activityId>.data` (~460 KB). Uses `activity` (summary numbers, the snapshot under `activity.user`, laps, segment passes) and `exportLink`. Ignores the embedded `timeseries` (undocumented numeric keys): per-second data comes from the Activity file.
- **Activity file:** `GET https://activities.virtualtraining.eu/export/activity_export_fit_<activityId>.fit`. Raw, uncompressed FIT on Google Cloud Storage. **No authentication**: it's a capability URL, so treat ids and the URL as secrets. Take the URL from `exportLink` (the route the web app uses). 403/404 there = *no Activity file* (§8).
- **`parseActivityFile()`** wraps `fit-file-parser` and maps only the fields we need into our own camelCase types: 1 Hz `record`s (`timestamp`, `heart_rate` when an HR strap was paired, `cadence`, `speed`, `power`, `altitude`, `distance`, `position_lat/long`), plus session and lap. Rouvy's files have no compressed timestamps and no developer fields. `fit-file-parser`'s `force` (skip CRC) defaults to true: set it deliberately.
- **Lenient schemas at the boundary:** validate only the fields we use, ignore unknown keys. A missing **required** field (id, start time, `exportLink`…) raises *Rouvy changed its API*, naming the route and field. A missing **optional** field (NP, HR aggregates…) is left out with a note.

Sources: [Recon Rouvy's web API](https://github.com/scastiel/rouvymcp/issues/5), [Parsing Rouvy Activity files in TypeScript](https://github.com/scastiel/rouvymcp/issues/4), [Resilience to Rouvy API drift](https://github.com/scastiel/rouvymcp/issues/11).

## 7. Politeness and caching

### Request budget

- **One request at a time** per server process, across every host (`riders.rouvy.com`, `activities.virtualtraining.eu`, and the login/refresh hosts). Each request starts at least **1 s** after the previous one ends.
- **Cloudflare 403** (HTML "Attention Required!"): never retried, and it starts a **15-minute cool-down**. During the cool-down no request goes out, and every tool call fails at once with *blocked by Rouvy's bot protection* plus the time it can try again.
- **429:** no automatic retry. Cool-down for `Retry-After` (60 s if missing, capped at 15 min). The tool error says "rate limited, try again in N s".
- **5xx or network error on a GET:** one retry after 2 s, then *Rouvy unavailable*. No cool-down.
- The auth retry (§4: refresh once on the logged-out signal) is separate from these.
- The cool-down is in memory and **process-wide** (it's about this machine, not the account). Restarting the client resets it.

### Cache

- **In memory only**, for the life of the process. Nothing on disk except the credentials file (and explicit exports, §5.6).
- Every entry is **keyed by uid**, so switching accounts never serves the previous account's data.

| What | Lifetime |
|---|---|
| Parsed Activity file | until evicted; LRU of about 20 Activities (written once at upload, never changes) |
| Detail payload | 10 min (RPE and validation status can still change) |
| List pages | 60 s; when page 0 is fetched again and its first Activity id changed, all list pages are dropped together (a new ride moves every offset by one) |

### Several processes

Each MCP client starts its own process with its own queue, cache and cool-down. No coordination between processes in M1.

Sources: [Politeness and caching](https://github.com/scastiel/rouvymcp/issues/12).

## 8. Errors

Every failure a tool can hit is one of these MCP tool errors (`isError: true`), each naming the fix. Response bodies are never echoed or logged.

| Kind | When | Message gist |
|---|---|---|
| Not logged in | no credentials file, refresh fails, or logged-out signal after one retry | "Run `npx -y rouvy-mcp login`, then retry." |
| Rouvy changed its API | a required field is missing, or a decode fails | names route and field; "update rouvy-mcp (restart your MCP client) or report it at <issues URL>" |
| Blocked by bot protection | Cloudflare 403 HTML, or during its cool-down | "try again after <time>; report it if it persists" |
| Rate limited | 429, or during its cool-down | "try again in N s" |
| Rouvy unavailable | 5xx or network error after one retry | "try later" |
| Activity not found | unknown id | — |
| No Activity file | 403/404 at the export URL | `get_activity` still works; intervals, window stats, streams and export return this. **Not** drift. |

Plus MCP input errors for invalid arguments (e.g. `limit > 50`, `end_sec <= start_sec`).

Sources: [Resilience to Rouvy API drift](https://github.com/scastiel/rouvymcp/issues/11), [Politeness and caching](https://github.com/scastiel/rouvymcp/issues/12).

## 9. Testing and drift detection

- **Unit/integration tests on committed, redacted real fixtures:**
  - one `activities-pagination.data` page and one `/activity/<id>.data` payload: ids, uid, names, email and `exportLink` replaced; geometry and `timeseries` cut short;
  - one real FIT file trimmed to about 2 minutes, positions set to FIT's invalid value, timestamps shifted. `fit-file-parser` only reads FIT, so redaction is **our own small script**: rewrite records in place, then fix the header data size and the CRC. No FIT encoder dependency.
- **Whole-ride NP check:** our NP over a whole-ride window lands close to Rouvy's NP. It runs on fixtures and in `contract:live`.
- **Daily account-free canary** (scheduled GitHub Actions, real UA, ~4 requests, opens a GitHub issue on failure):
  - anonymous `GET` of `resources/activities-pagination.data` and `/activity/<bogus>.data` → expect 202 + turbo-stream v2 `SingleFetchRedirect` to `account.rouvy.com/sign-in`. Cloudflare 403 HTML = UA rule changed. Decode failure = encoding changed.
  - bogus-credential Firebase `signInWithPassword` with the pinned key → expect `INVALID_LOGIN_CREDENTIALS`, not `API_KEY_INVALID`;
  - Rouvy's sign-in page still contains the pinned Firebase key;
  - **no POSTs to Rouvy** (`auth.data`, `login.data`).
- **`npm run contract:live`**, maintainer-run before each release, using the maintainer's own credentials file: fetch a list page, one detail and its Activity file, validate them against the schemas, run the NP check. **No Rouvy token is ever stored in CI secrets.**

Sources: [Resilience to Rouvy API drift](https://github.com/scastiel/rouvymcp/issues/11), [Source of Activity summary numbers](https://github.com/scastiel/rouvymcp/issues/10).

## 10. Distribution and CI

- **Transport:** stdio only.
- **Package:** `rouvy-mcp` on npm (package, `bin` and repo name; rename the repo from `rouvymcp`). Tagline: "Unofficial Rouvy MCP server". License **MIT**.
- **Install line** in the README, for any MCP client: `npx -y rouvy-mcp@latest` (`@latest` keeps the npx cache from serving a stale version), plus `npx -y rouvy-mcp login` once in a terminal, and the optional `ROUVY_MCP_EXPORT_DIR` env.
- **Node:** `engines: node >=22`; CI matrix on 22, 24, 26. Raise to 24 when 22 reaches end-of-life (April 2027).
- **Releases:** `0.x` semver, published from GitHub Actions on tag with **npm trusted publishing** (provenance, no long-lived token). Fixes for Rouvy drift ship as patch releases. No update check or phone-home: the server makes no requests beyond Rouvy's.
- **Visibility:** the repo stays private until M1 is usable. Then the public repo and the first npm release go out together, with the disclaimer (§11) in the README.

Sources: [Transport and distribution](https://github.com/scastiel/rouvymcp/issues/8), [Resilience to Rouvy API drift](https://github.com/scastiel/rouvymcp/issues/11).

## 11. Disclaimer

Goes into the README verbatim (with the project name updated to `rouvy-mcp`):

> **Unofficial project.** rouvy-mcp is not affiliated with, endorsed by, or supported by ROUVY or VirtualTraining s.r.o. "ROUVY" is a trademark of its owner.
>
> Rouvy has no public API. This tool talks to Rouvy's private web API with **your own** account, from **your own** machine, and only reads data. Rouvy's [Terms of Use](https://rouvy.com/en/terms-of-use) (§29.h) prohibit reverse engineering and "using any automated means for accessing and using ROUVY". Using this tool may breach those terms, and Rouvy may suspend or terminate your account without a refund (§15, §29.d). The API may change or stop working at any time.
>
> **Use at your own risk.** The software is provided "as is", without warranty of any kind (see LICENSE). The authors aren't responsible for any consequences to your Rouvy account or data. Nothing here is legal advice.
>
> If you'd rather stay within Rouvy's terms, use Rouvy's official integrations (e.g. Intervals.icu, Strava, Garmin Connect) or request a copy of your data from Rouvy under the GDPR (gdpr@rouvy.com).

Sources: [Rouvy terms of service and reverse-engineering risk](https://github.com/scastiel/rouvymcp/issues/3) (clauses quoted on branch [`research/tos-risk`](https://github.com/scastiel/rouvymcp/blob/research/tos-risk/research/tos-risk.md)).

## 12. Build order

Vertical slices, each usable on its own. Turning them into implementation issues is a separate step after this spec.

1. **Scaffold + auth CLI.** Package, TypeScript, CI matrix, UA constant, credentials file provider, `login` / `logout` / `status`. **First, verify the `securetoken` refresh** (§4) and switch to the fallback if it fails.
2. **`list_activities` end to end.** Rouvy HTTP client (queue, spacing, cool-downs, retries, error kinds), turbo-stream v2 decoding, lenient schemas, list cache, `createServer()` + stdio `bin`, redacted list fixture.
3. **`get_activity`.** Detail payload, Activity snapshot, missing-value notes, detail cache, redacted detail fixture.
4. **Activity file + analysis.** Download via `exportLink`, `parseActivityFile()`, the stats module, `get_activity_intervals`, `get_window_stats`, the NP check, the FIT redaction script and fixture, the *no Activity file* path, the Activity file LRU.
5. **`get_activity_streams`.** Downsampling with the 500-point cap.
6. **`export_activity_file`.** `ROUVY_MCP_EXPORT_DIR`, conditional registration, FIT/CSV writing.
7. **Drift tooling.** Daily canary workflow, `npm run contract:live`.
8. **Release.** README (install, login, disclaimer), repo rename to `rouvy-mcp`, make it public, trusted publishing, `0.1.0`.

---

## Appendix A: Rouvy web API

Captured 2026-10-24 from a logged-in Chrome session (build `bn=303`), then replayed from Node. Identifiers redacted: `<uid>` = Firebase uid, `<activityId>` = Activity id. Original notes: branch [`recon/rouvy-web-api`](https://github.com/scastiel/rouvymcp/blob/recon/rouvy-web-api/recon/rouvy-web-api.md); login probing: [Programmatic login path past Rouvy's Cloudflare](https://github.com/scastiel/rouvymcp/issues/9).

### Anonymous / logged-out

`GET https://riders.rouvy.com/<any>.data` without a session → **HTTP 202**:

```
[["SingleFetchRedirect",1],{"redirect":"https://account.rouvy.com/sign-in?riders=true&redirectTo=%2F<path>","status":302,...}]
```

Anonymous `.data` reads pass Cloudflare with any UA.

### Activity list

```
GET https://riders.rouvy.com/resources/activities-pagination.data
    ?offset=<n>&firebaseUid=<uid>&_routes=routes%2Fresources.activities-pagination
```

Decoded `["routes/resources.activities-pagination"].data`:

```jsonc
{
  "activities": [{
    "id": "YYMMDDhhmmss-xxxxxxxx",        // timestamp + 8-char random suffix
    "title": "<route name>",
    "training": "ROUTE",                  // also seen: "WORKOUT_FTP_TEST"
    "startUTC": "2026-01-01T12:00:00.000Z",
    "startDateDisplay": "1 janv. 2026, 07:00 UTC−5",   // localised by the locale cookie
    "coins": 0, "experience": 0, "trainingScore": 0,
    "images": [{ "url": "…", "thumbnailUrl": "…" }],
    "user": { "firebaseUid", "username", "firstName", "lastName", "gender", "countryCode", "avatar", "careerBadgeUrl", "ageGroup" },
    "total": { "distM": 0, "elevM": 0, "kCal": 0, "movingTimeSec": 0, "longestRide": 0, "tss": 0, "if": 0 },
    "routeEstimatedTimeSec": 0, "routeId": "<routeId>", "workoutId": null, "routeThumbnail": "…"
  }],
  "offset": 0,
  "error": null
}
```

### Activity detail

`GET https://riders.rouvy.com/activity/<activityId>.data`: ~460 KB, mostly route geometry; six keys deferred. Under `["routes/_main.activity.$id"].data`:

| key | contents |
|---|---|
| `activity` | the list item fields, plus `user.{FTP, weightKg, maxHr, zones{hr[7], pwr[7]}}` (the Activity snapshot); `total.{NP, IF, TSS, PP[7], elapsedTimeSec, zeroWTimeSec, aggrs{cadRPM,hr,pwrW,spdMs}{min,max,avg}, hists{hr[7],pwr[7]}}`; `checkStatus`, `failedValidators`, `drafting`, `eventSessionId`, `executionScore`, `rateOfPerceivedExertion`, `laps[]`, `segmentsPasses[]`, `timeseries[]` |
| `exportLink` | the Activity file URL |
| `userFtp`, `userMaxHr`, `userData{ftp, weight, zoneValues}` | current Rider settings (not used) |
| `route`, `geometry` | route overview and profile points (not used) |
| `isOwner`, `currentUserUid`, `providers[]`, leaderboards, … | page furniture (not used) |

`timeseries` (not used; for reference): per-second `{key, values[]}`. `1` HR, `2` cadence, `3` speed m/s, `4` power, `5` altitude, `12`/`RouteDistance` distance, `18`/`19` lat/lon, `16` and `102` unknown.

### Activity file

`GET https://activities.virtualtraining.eu/export/activity_export_fit_<activityId>.fit`

- Raw FIT, `application/octet-stream`, ~25 bytes per ride second. Google Cloud Storage, `cache-control: public, max-age=3600`, `last-modified` = ride end time (written at upload).
- No auth, any UA. Wrong id suffix → 403 (no listing).
- Contents: 8 definition messages; 1 Hz `record`s; 1 session; 1 lap; `activity`; `device_info` (`manufacturer: virtualtraining`, `product_name: Rouvy`); no `file_id`, no compressed timestamps, no developer fields.

### Login and session

- `POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<key>`: JSON `{email, password, returnSecureToken: true}` → `idToken` (1 h), `refreshToken`, `localId`.
- `POST https://account.rouvy.com/resources/auth.data`: form `{idToken, uid, refreshToken, riders: "true", isNew: "false"}` → 202 redirect to `/redirect/riders-portal`, `Set-Cookie: rouvy_session` (`Domain=rouvy.com; HttpOnly; Secure; SameSite=Lax`, 30 days) and `rouvysession_tos` (1 day).
- `rouvy_session` = base64 JSON `{idToken, refreshToken, uid}`; works on `riders.rouvy.com` on its own.
- `POST https://securetoken.googleapis.com/v1/token?key=<key>`: `grant_type=refresh_token&refresh_token=…` → new `id_token` (standard Firebase; accepted by `auth.data`, verified §4).
- `POST https://riders.rouvy.com/login.data` (prior art's route): behind a Cloudflare UA-pattern rule and an apparent login rate rule. Not used.
