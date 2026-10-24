# Recon: Rouvy's web API (auth, Activity list, Activity detail, Activity file)

Captured 2026-10-24 by driving `riders.rouvy.com` in Chrome (Chrome DevTools MCP) from a
logged-in session (build `bn=303`, manifest version `d5254c19`), then replaying read
requests from Node. Every identifier below is redacted: `<uid>` is the user's Firebase UID,
`<activityId>` an Activity id. No fixture is committed (the FIT files hold personal heart
rate and power data); they stay on the recon machine.

## Vocabulary

Rouvy calls a ride an **Activity** ("Activités", "Détail de l'activité"; route `/activity/:id`).
The download button is labelled **EXPORT**. The map's vocabulary holds.

## Architecture recap

`riders.rouvy.com` is a Remix / React Router 7 app behind Cloudflare. Each page has a
single-fetch data route at `<path>.data` that returns `text/x-script`, encoded with
**turbo-stream v2**. `turbo-stream@2.4.1` decodes every captured body. `turbo-stream@3.2.1`
"decodes" them into junk, so pin `^2`. Some loader keys are **deferred**: they arrive as
promises later in the same response, so the decoder has to await nested promises.

## Endpoint catalog

### Session check / anonymous behaviour

`GET https://riders.rouvy.com/<any>.data` without a session returns **HTTP 202** with a
single-fetch redirect payload:

```
[["SingleFetchRedirect",1],{"redirect":"https://account.rouvy.com/sign-in?riders=true&redirectTo=%2F<path>","status":302,...}]
```

So "logged out" is detected as a `SingleFetchRedirect` to `account.rouvy.com/sign-in`, not a
401. Anonymous `.data` reads pass Cloudflare with any UA (project UA, curl default,
`python-requests`).

### Activity list

```
GET https://riders.rouvy.com/resources/activities-pagination.data
    ?offset=<n>
    &firebaseUid=<uid>
    &_routes=routes%2Fresources.activities-pagination
```

- Cookie session required. `firebaseUid` is required: it's the user's own UID, available as
  `root.userId` in any page's `.data` and as `uid` inside the session cookie.
- Page size 10. `offset` is a row offset (0, 10, 20…). The end of the list is an empty
  `activities` array (no total or `hasMore` field).
- Decoded shape (`["routes/resources.activities-pagination"].data`):

```jsonc
{
  "activities": [{
    "id": "YYMMDDhhmmss-xxxxxxxx",        // timestamp + 8-char random suffix
    "title": "<route name>",
    "training": "ROUTE",                  // also seen: "WORKOUT_FTP_TEST"
    "startUTC": "2026-01-01T12:00:00.000Z",
    "startDateDisplay": "1 janv. 2026, 07:00 UTC−5",   // localised by the locale cookie
    "coins": 0, "experience": 0, "trainingScore": 0,
    "images": [{ "url": "…", "thumbnailUrl": "…" }],   // in-ride screenshots
    "user": { "firebaseUid", "username", "firstName", "lastName", "gender", "countryCode", "avatar", "careerBadgeUrl", "ageGroup" },
    "total": { "distM": 0, "elevM": 0, "kCal": 0, "movingTimeSec": 0, "longestRide": 0, "tss": 0, "if": 0 },
    "routeEstimatedTimeSec": 0, "routeId": "<routeId>", "workoutId": null, "routeThumbnail": "…"
  }],
  "offset": 0,
  "error": null
}
```

The profile page (`/profile/overview`) uses this route to show its "Recent activities" list.

### Activity detail

```
GET https://riders.rouvy.com/activity/<activityId>.data
```

About 460 KB, mostly route geometry. Six keys are deferred. The useful data sits under
`["routes/_main.activity.$id"].data`:

| key | contents |
|---|---|
| `activity` | everything in the list item, plus: `user.{FTP, weightKg, maxHr, zones{hr[7], pwr[7]}}`; `total.{NP, IF, TSS, PP[7] (power peaks 5s/30s/1m/5m/20m/30m/60m), elapsedTimeSec, zeroWTimeSec, aggrs{cadRPM,hr,pwrW,spdMs}{min,max,avg}, hists{hr[7],pwr[7]}}`; `checkStatus`, `failedValidators`, `drafting`, `eventSessionId`, `executionScore`, `rateOfPerceivedExertion`, `laps[]`, `segmentsPasses[]` (per-segment time/power/HR/speed), **`timeseries[]`** |
| `exportLink` | the Activity file URL (below) |
| `userFtp`, `userMaxHr`, `userData{ftp, weight, zoneValues}` | rider settings at view time |
| `route` | route overview (name, distance, elevation, segments, `geometryJsonUrl`, …) |
| `geometry` | full route profile points `{distance, altitude, latitude, longitude, slope}` |
| `isOwner`, `currentUserUid`, `providers[]` (16 connected-app statuses), leaderboards, nearby riders, `workoutSegments` | page furniture |

`activity.timeseries` is a **per-second** series embedded in the detail payload. Each entry
is `{key, values[]}`, and every series has the same length (1957 points for a 1956 s ride):

| key | meaning (inferred from values and FIT comparison) |
|---|---|
| `1` | heart rate (bpm) |
| `2` | cadence (rpm) |
| `3` | speed (m/s) |
| `4` | power (W) |
| `5` | altitude (m) |
| `12`, `RouteDistance` | distance (m) |
| `16` | unknown (values like 9.22, 6.87, 5.81; maybe grade or drafting factor) |
| `18`, `19` | latitude, longitude |
| `102` | unknown (zeros at the start) |

So per-second data is available **without the FIT file**, but with undocumented numeric keys.

### Activity file (EXPORT)

```
GET https://activities.virtualtraining.eu/export/activity_export_fit_<activityId>.fit
```

- **Raw FIT, not compressed** (`application/octet-stream`, about 25 bytes per second of ride:
  50 KB for 33 min). Served by Google Cloud Storage (`x-goog-*` headers),
  `cache-control: public, max-age=3600`, `x-goog-expiration` about 2 years after upload.
- **No authentication.** It works with no cookies and any UA. It's a capability URL: anyone
  holding the id can download the file. A wrong suffix returns 403 (no bucket listing), so ids
  can't be enumerated. Treat Activity ids and export URLs as secrets: never log them.
- The URL is derived from the Activity id alone. It's also published as `exportLink` in the
  detail payload. That makes the detail call optional for downloads, but it's the route the
  web app itself uses to get the link.
- The file exists for both the newest Activity and the oldest one on this account (6 days
  apart). `last-modified` equals the ride's end time, so it's written at upload, not on demand.
  Older years are untested (the test account only has October 2026 rides).

FIT contents (2 files checked):

- 8 definition messages, **no compressed-timestamp headers, no developer fields**.
- `record` at 1 Hz: `timestamp, heart_rate (when an HR strap is paired), cadence, speed, power,
  altitude, distance, position_lat, position_long`. Plus 1 session, 1 lap, `activity`, and
  `device_info` (`manufacturer: virtualtraining`, `product_name: Rouvy`). `file_id` is absent
  (fit-file-parser exposes none).
- `fit-file-parser` and `@garmin/fitsdk` both parse both files: same record counts, CRC
  integrity OK, zero decoder errors. The parser choice from the parsing ticket stands.

## Login and session

- Signing in now happens on **`account.rouvy.com/sign-in?riders=true&redirectTo=…`**
  (Firebase-backed). The login requests themselves weren't captured: the user signed in
  before capture was armed.
- The session is the HttpOnly cookie **`rouvy_session`** (domain `riders.rouvy.com`):
  base64 JSON `{ idToken, refreshToken, uid }`. `idToken` is a **Firebase ID token (JWT)
  valid for 1 h** (`exp − iat = 3600`). The refresh token is a standard Firebase refresh
  token (long-lived until revoked or the password changes). Rouvy's server presumably mints a
  new `idToken` from it. Not confirmed: no `Set-Cookie` was seen within the first hour, and
  the cookie's own `Max-Age` wasn't visible. Other cookies: `rouvysession_tos`, `locale`,
  `CH-time-zone`, Cloudflare `__cf_bm`, plus analytics.
- **Firewall on login:** Cloudflare answers "Attention Required!" (HTTP 403) to
  `GET /login` and `GET /login.data` for every non-browser UA. A single
  `POST /login.data` with bogus credentials and an honest UA
  (`rouvymcp-recon/0.0 (+https://github.com/scastiel/rouvymcp)`) was **also blocked (403)**,
  from both curl and Node `fetch`. Meanwhile `home-assistant-rouvy`'s daily canary (same
  POST, its own project UA, aiohttp) passed on 2026-10-24. The cause is unknown (UA-pattern
  rule, TLS fingerprint, or IP reputation after the GET probes). Probing stopped there, per
  the politeness charter: no browser UA, no other project's UA.

## What this means downstream

- **Auth model:** programmatic password login is **not proven** for this project. Options
  to weigh: (a) a password POST to `login.data` if the block turns out to be transient or
  UA-specific; (b) Firebase REST `signInWithPassword` + `account.rouvy.com/resources/auth`
  (the documented fallback in prior art, untested here); (c) the user hands over a
  `rouvy_session` cookie (or just its refresh token) from their browser. That's long-lived
  because of the Firebase refresh token, but it's a high-value secret.
- **Tool surface:** list = `activities-pagination` (offset paging, needs uid); summary =
  detail `.data` `activity` object; raw data = FIT via `exportLink` (needs no session), or the
  embedded `timeseries`.
- **Drift canaries** that need no account: anonymous `.data` → `SingleFetchRedirect` to
  `account.rouvy.com`; turbo-stream v2 still decodes; the export host still serves
  `application/octet-stream`.
