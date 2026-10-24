# Prior art: unofficial Rouvy clients and data paths

Research for [#2](https://github.com/scastiel/rouvymcp/issues/2) (map: [#1](https://github.com/scastiel/rouvymcp/issues/1)).
Researched 2026-10-24. Every claim links to the source that owns it; repo freshness is the last commit date on the default branch at research time.

## TL;DR

- **One client is worth building on: [`mikejhill/home-assistant-rouvy`](https://github.com/mikejhill/home-assistant-rouvy)** (MIT, Python, v2.0.2, last commit 2026-10-21, daily contract canary). It talks to the same Remix "single fetch" `*.data` routes that `riders.rouvy.com` uses, decodes the turbo-stream wire format, and has a working **email + password form login** (rebuilt 2026-10-10 after Rouvy broke v1). It already lists Activities via `resources/activities-pagination.data`.
- **Nobody has published the Activity file download.** No client, script, or Rouvy help page found documents an endpoint that returns a FIT/TCX/GPX for a completed Activity. That stays the main unknown for Recon (#5).
- Everything else found (Chrome extensions, scrapers, route tools) is stale (2020 to 2024), targets the retired `my.rouvy.com` site, or covers routes rather than Activities. Useful only as history.
- **Third-party syncs are a real alternative data path.** Rouvy pushes finished Activities to ~16 connected apps. Of those, **intervals.icu has an official, documented API with a personal API key that returns the *original* uploaded activity file** (`GET /api/v1/activity/{id}/file`). Strava's API gives streams but not the original file.

**Recommendation:** port the approach (not the code) of `home-assistant-rouvy` to TypeScript: `riders.rouvy.com` `*.data` routes, the `turbo-stream` npm decoder, cookie session from `login.data`, an honest project user agent, and its error taxonomy and contract canary. Have Recon (#5) focus on (a) the Activity detail route and (b) the Activity file download, which nobody has mapped. Keep intervals.icu in mind as a fallback for raw data if the Rouvy file download proves unusable.

## Sources

### 1. `mikejhill/home-assistant-rouvy`: build on this (high trust, fresh)

- Repo: <https://github.com/mikejhill/home-assistant-rouvy>. MIT. 63 commits, first 2026-02-16, last 2026-10-21. Typed async library `rouvy_api` + CLI + Home Assistant integration. Not published on PyPI (`rouvy-api` and `home-assistant-rouvy` both 404); shipped through HACS/GitHub releases.
- **Trust:** high. Real captured (redacted) fixtures in `tests/fixtures/`, ≥95% branch coverage target, and a [daily contract canary workflow](https://github.com/mikejhill/home-assistant-rouvy/blob/main/.github/workflows/contract.yml) that runs account-free checks against live Rouvy and opens an issue on failure ([`tests/contract/test_rouvy_contract.py`](https://github.com/mikejhill/home-assistant-rouvy/blob/main/tests/contract/test_rouvy_contract.py)).

**Host & transport** ([`src/rouvy_api/config.py`](https://github.com/mikejhill/home-assistant-rouvy/blob/main/src/rouvy_api/config.py))

- Base URL `https://riders.rouvy.com`. Every route is a Remix single-fetch data route (`<path>.data`): `GET` for loaders, form-encoded `POST` for actions.
- Responses are **turbo-stream** encoded (flat JSON array with index references, then optional `P<id>:` promise lines). The Python decoder cites [jacob-ebey/turbo-stream](https://github.com/jacob-ebey/turbo-stream) "v2 flat encoding" ([`turbo_stream.py`](https://github.com/mikejhill/home-assistant-rouvy/blob/main/src/rouvy_api/turbo_stream.py)). In TS we can use the [`turbo-stream`](https://www.npmjs.com/package/turbo-stream) npm package directly. Caveat: npm `latest` is 3.2.1, and the v3 wire format may differ from what Rouvy serves. Pin whichever major version matches Rouvy's bundle (check during recon).
- **Cloudflare sits in front and rejects generic HTTP-library user agents** (python-requests, aiohttp). The project sends `home-assistant-rouvy/<version> (+repo URL)` and deliberately does not spoof a browser; a canary test asserts that this UA is not 403'd ([ADR 0002](https://github.com/mikejhill/home-assistant-rouvy/blob/main/docs/adr/0002-login-and-session-handling.md)). Node's `fetch` default UA (`node`) would probably be blocked as well. Set an explicit project UA.
- Politeness: hourly polling, at most 4 concurrent requests ([project charter](https://github.com/mikejhill/home-assistant-rouvy/blob/main/docs/project-charter.md)).

**Auth flow** ([ADR 0002](https://github.com/mikejhill/home-assistant-rouvy/blob/main/docs/adr/0002-login-and-session-handling.md), [`auth.py`](https://github.com/mikejhill/home-assistant-rouvy/blob/main/src/rouvy_api/auth.py), [`client.py`](https://github.com/mikejhill/home-assistant-rouvy/blob/main/src/rouvy_api/client.py))

- Interactive sign-in moved to an email-first flow on `account.rouvy.com` (client-side Firebase, then `account.rouvy.com/resources/auth`). The riders portal **still accepts a server-side form login**: `POST https://riders.rouvy.com/login.data` with form fields `email`, `password`. Rouvy validates the password with Firebase server-side and sets session cookies.
- A rejected login is **still HTTP 200**: a turbo-stream action payload with `status: "error"` and Firebase codes (`auth/invalid-credential`, `auth/user-disabled`, `auth/too-many-requests`, …). **The error payload echoes the submitted password back**, so never log login response bodies.
- Verify the login with `GET user-settings.data`. An unauthenticated read returns a sign-in redirect inside the payload (or HTTP 401), not an HTML page.
- Re-login is transparent: on 401 or a sign-in redirect it logs in once more under a lock, then retries.
- Documented fallback if `login.data` is retired: Firebase REST `accounts:signInWithPassword`, then `account.rouvy.com/resources/auth`.
- Social-login-only accounts (Google/Apple/Facebook) are unsupported; the rider must set a Rouvy password.
- **History of breakage:** v1 (Feb to Apr 2026) called `/_root.data` after login. Rouvy removed that route (404) and Cloudflare started blocking library UAs, which broke v1 until the v2 rewrite on 2026-10-10 ([CHANGELOG](https://github.com/mikejhill/home-assistant-rouvy/blob/main/CHANGELOG.md)). This is concrete evidence that the API drifts within months.

**Known routes** (`Endpoint` enum in `config.py`, plus parser docstrings)

| Route | Method | What it returns / does |
| --- | --- | --- |
| `login.data` | POST `email`,`password` | Session cookies; form error on failure |
| `user-settings.data` | GET | Profile (name, weight, height, FTP, units, timezone, …) |
| `user-settings.data?index` | POST (`intent=…`) | Profile/privacy updates (write; out of scope for us) |
| `user-settings/zones.data` | GET / POST | Power & HR zones |
| `user-settings/connected-apps.data` | GET | Active/available connected apps (Strava, Garmin, intervals.icu, …) |
| `profile/overview.data` | GET | **Recent activities**, period totals, career, friends |
| **`resources/activities-pagination.data`** | GET | **Activity list, 10 per page, with an `offset` field** (parser + fixture only; the client has no public method yet) |
| `resources/activity-stats.data` | POST `year`,`month` | Weekly totals per activity type |
| `challenges/status/available.data`, `routes.data`, `routes/collection/favourite.data`, `events.data`, `profile/achievements.data`, `profile/trophies.data` | GET | Not Activities; out of scope |

**Activity list shape** (from the redacted capture [`tests/fixtures/activities-pagination-data.txt`](https://github.com/mikejhill/home-assistant-rouvy/blob/main/tests/fixtures/activities-pagination-data.txt), decoded):

- `id`: string like `260203005638-6d8733d6` (looks like `yyMMddHHmmss-<hex>`)
- `title`, `startUTC` (ISO), `startDateDisplay`, `training` (`ROUTE_TIME_TRIAL`, `WORKOUT`, …), `routeId`, `workoutId`
- `total`: `{ distM, elevM, kCal, movingTimeSec, longestRide, tss, if, routeEstimatedTimeSec }`
- `trainingScore`, `experience`, `coins`, `user{…}`, `media[]`, `images[]`, `routeThumbnail`
- Top level: `activities[]` and `offset`. The exact query parameter for paging still needs confirming in recon.

**Not covered:** no Activity *detail* route and **no Activity file download**. The charter lists "live ride telemetry (power, cadence)" as a non-goal because "Rouvy does not expose it on the web". That is the author's view of the web UI, not proof that a file export is missing.

### 2. `mikejhill/web-auth-bridge`: alternative auth approach (medium trust, Apr 2026)

- <https://github.com/mikejhill/web-auth-bridge> (MIT, on PyPI, last commit 2026-04-16). Generic library: Playwright performs the login once, then cookies are cached and replayed with httpx.
- Its live e2e test [`tests/e2e/test_rouvy_live.py`](https://github.com/mikejhill/web-auth-bridge/blob/main/tests/e2e/test_rouvy_live.py) logs in at `https://riders.rouvy.com/login` (HTML form, dismisses a Cookiebot banner), waits for `/feed`, and keeps cookies whose domain ends in `rouvy.com`. This predates the email-first flow, so treat it as stale for the exact selectors. The **pattern** (browser login, then cookie reuse) is relevant to our auth-model decision: it avoids handling the password at all.

### 3. Stale or off-topic community code (low value for M1)

| Source | Last commit | What it reveals | Verdict |
| --- | --- | --- | --- |
| [`filemon/rouvy_extension`](https://github.com/filemon/rouvy_extension) | 2022-10-15 | Chrome extension + Apify scrapers for career, challenges, races, routes on the **retired `my.rouvy.com`** HTML site | Historical only |
| [`MatthiasHeilManchester/rvy_racing`](https://github.com/MatthiasHeilManchester/rvy_racing) | 2024-09-22 | Selenium scripts creating/extracting races on `my.rouvy.com/onlinerace` and `riders.rouvy.com/events/setup` | Browser automation, events only |
| [`stefaandesmet2003/hometrainer`](https://github.com/stefaandesmet2003/hometrainer) (`makerides/`) | 2024-03-09 | Route search. Older public JSON `https://rouvy.com/api/route/search?offset=…`, then Remix v1 `riders.rouvy.com/routes/search?..._data=routes%2F_main.routes.search`, route tracks at `cdn.virtualtraining.eu/routes/{id}/track.xml` | Shows the API evolution (`?_data=` in Remix v1, then `.data` single fetch); routes only |
| [`davidcane-oz/RouvyStuff`](https://github.com/davidcane-oz/RouvyStuff) | 2022-11-02 | Formats manually saved `career.json` / `achievements.json` | Nothing on Activities |
| [`mikebarkmin/rouvy-tools`](https://github.com/mikebarkmin/rouvy-tools) | 2021-09-26 | Converts Zwift workouts to `.mrc` | Workouts, not data access |
| [`Oliva-Michael/Rouvy`](https://github.com/Oliva-Michael/Rouvy), `filipvlkous/rouvy-test` | 2024 / 2025 | Placeholder or test repos (one points at `riders.rouvy.dev`) | Nothing usable |
| npm search "rouvy" | n/a | Only `rouvy-observability-js` (Rouvy's own internal Datadog package, 2025-02) and `gymnasticon` | No client |
| PyPI simple index | n/a | No package with "rouvy" in its name | No client |

Many other "rouvy" GitHub repos are trainer bridges, Linux/Wine ports, or SEO spam. They are irrelevant here.

### 4. Rouvy's own help center (first-party, no API docs)

Fetched through the Zendesk help-center API on 2026-10-24.

- [My Activities](https://support.rouvy.com/hc/en-us/articles/360018805618-My-Activities) (updated 2026-09-17): Activities are listed in the profile and in the **Training Calendar** on ROUVY.com. Clicking an Activity opens a detail page with "detailed activity graphs". It has a **Share** button that pushes the Activity to a connected app. The article never mentions a file download/export button. "Your activities are saved permanently."
- [ROUVY and Intervals.icu](https://support.rouvy.com/hc/en-us/articles/35523188955793-ROUVY-and-Intervals-icu) (updated 2026-10-13) and [ROUVY and STRAVA](https://support.rouvy.com/hc/en-us/articles/10604157830161-ROUVY-and-STRAVA) (updated 2026-10-23): sync is configured on `riders.rouvy.com` > Connected Apps. **Auto** mode uploads each Activity when it ends. **Manual** mode shares per Activity from the training calendar.
- [I Have Problems Uploading My Activities](https://support.rouvy.com/hc/en-us/articles/12988285107345-I-Have-Problems-Uploading-My-Activities): the app uploads Activities to Rouvy's servers (it can take hours). This confirms the server holds the full ride data.
- No help article describes a FIT/TCX/GPX download. A Wahoo community post claims "you can export fit file for your activity" ([wahoox forum, p.3](https://wahoox.forum.wahoofitness.com/t/need-help-from-former-or-current-rouvy-users/20952?page=3)). That is anecdotal and undated in the excerpt. **Treat the existence of the file download as unverified until recon.**

### 5. Third-party syncs as an alternative data path

The captured `user-settings/connected-apps.data` fixture in `home-assistant-rouvy` lists the providers and their permissions: `garminconnect` and `strava` (both with `ACTIVITY_EXPORT` / `ACTIVITY_IMPORT`; Strava scope `read,activity:write,activity:read_all,profile:read_all,read_all`), plus CoachCat, Coros, Final Surge, Hammerhead, HumanGO, **Intervals.icu**, Map My Fitness, Relive, Ride with GPS, Suunto, TrainingPeaks, TriDot, Wahoo, Xert, XHale. Rouvy **pushes** Activities to these services. They do not pull from Rouvy.

- **intervals.icu** (official public API, [OpenAPI spec](https://intervals.icu/api/v1/docs), [API access thread](https://forum.intervals.icu/t/api-access-to-intervals-icu/609)): HTTP Basic auth with username `API_KEY` and a personal key from Settings > Developer; athlete id `0` means "me". Limits: 5,000 requests/day, 2,500 per 15 minutes. Relevant endpoints: `GET /api/v1/athlete/{id}/activities` (date range), `GET /api/v1/activity/{id}` (summary + intervals), **`GET /api/v1/activity/{id}/file` (download original activity file; not for Strava-sourced activities)**, `GET /api/v1/activity/{id}/streams{ext}`, and `fit-file` (intervals-generated FIT). The Rouvy integration went live on 2025-02-04 ([forum thread](https://forum.intervals.icu/t/rouvy-integration/87115)). Rouvy **does not backfill** Activities from before the connection, and the intervals.icu developer says he has "no control over what Rouvy uploads".
- **Strava**: Rouvy auto-uploads by default. The Strava API (OAuth app required) returns activity streams but not the original file. Strava-sourced activities cannot be downloaded from intervals.icu either.
- **Garmin Connect / TrainingPeaks**: receive Activity files from Rouvy, but their APIs are partner-gated (no personal-key access).

**Assessment:** intervals.icu is the only clean, documented, personal-credential path to the per-second data. It needs the user to have the integration connected, and it only covers Activities synced after connecting. It is a fallback or an optional second source, not a replacement for a Rouvy client (it lacks Rouvy-specific summary fields such as XP, coins, route ID and training score).

## Implications for the map

1. **Base URL, auth, and wire format are mostly known**: `riders.rouvy.com` `*.data` single-fetch routes, turbo-stream, form login at `login.data` with cookie session, project UA required. Recon (#5) can confirm these quickly and spend its time on the unknowns.
2. **Unknowns for Recon (#5):**
   - the Activity **detail** route (likely `activities/<id>.data` or similar; unverified);
   - the **Activity file download**: whether it exists on the web, its URL, its format (FIT? TCX?), and whether it lives on `riders.rouvy.com` or another host/CDN;
   - the paging parameter for `resources/activities-pagination.data`;
   - whether `login.data` still accepts form logins (it worked as of 2026-10-11, and the canary runs daily).
3. **Auth-model decision** has two proven options: (a) store the password and post it to `login.data` (simple, but we hold a password); (b) the user logs in in a browser and we reuse cookies (`web-auth-bridge` pattern; no password stored, more setup). The risk stance in #1 ("never store plain passwords where avoidable") favours exploring (b) or OS-keychain storage for (a).
4. **Drift resilience:** copy the canary idea, i.e. account-free checks that the login error still parses, the UA passes Cloudflare, and anonymous reads still redirect. That gives drift detection without credentials in CI.
5. **Licensing:** `home-assistant-rouvy` is MIT. Porting its approach to TS with attribution is fine. We are not vendoring Python.
