# Research: Rouvy's Workout API (routes, format, ownership, edit and delete)

Research for [#74](https://github.com/scastiel/rouvy-mcp/issues/74) (map: [#73](https://github.com/scastiel/rouvy-mcp/issues/73)).
Researched 2026-10-26. This branch is throwaway and never merged. The live capture in [#75](https://github.com/scastiel/rouvy-mcp/issues/75) confirms or corrects it.

**How it was researched.** Nothing logged in and nothing authenticated. Rouvy's help centre was read through its public Zendesk JSON API, because the HTML pages answer 403 to non-browser clients. `riders.rouvy.com` puts every page, `/login` included, behind a Cloudflare challenge for non-browser clients, so the **current** web-app bundle was out of reach without a browser. The route names and shapes below come instead from **Wayback Machine snapshots of the public web-app bundle** (route manifest `manifest-1ba230a5.js`, archived 2025-07-01, and the workout route chunks archived 2025-07-02). That build is about 16 months older than the one M1 recon captured (`bn=303`, 2026-10-24). **Treat every route name and field below as "true in mid-2025, probably still true".** No Rouvy code is copied here: routes and shapes are described in my own words.

Confidence: **High** = stated by a first-party source, or read directly off Rouvy's bundle and consistent with the help centre. **Medium** = read off the 2025 bundle only, or inferred from client code about what the server does. **Low** = inference.

## TL;DR

- **Every Workout operation has a web-app route** ([§1](#1-routes)): list via the Workouts page and collection pages, read `GET /workouts/:id`, create `POST /workouts/create`, edit `POST /workouts/:id/edit`, delete `POST /workouts/:id` with a hidden `id` field, plus a **file import route `POST /resources/workout-upload`** (multipart, one `file` field) that answers with the new `workoutId`. These are ordinary Remix loaders and actions on `riders.rouvy.com`, the same family M1 already reads.
- **The step model is flat and small** ([§2](#2-wire-shape)): an ordered list of segments, each `CONSTANT`, `RAMP` or `FREE_RIDE`, with a duration in seconds, a start and end target, and an optional cadence range. Text cues are a separate list positioned by seconds from the start. **There is no repeat or interval-set construct**: repeats are written out segment by segment.
- **The web creator writes only % FTP, time-based Workouts.** The model also knows `POWER` (watts) and `WKG` targets and `DISTANCE` durations, but the creator schema accepts only the `FTP` target kind. The **Edit** action only appears on Workouts that are both owned and % FTP plus time-based. Delete only needs ownership.
- **Import accepts `.zwo`, `.erg` and `.mrc` only** (help centre and bundle agree). FIT is not accepted. ZWO ramps and free rides survive import (changelog 4.0.4). ZWO `IntervalsT` repeats necessarily get flattened. What happens to `MaxEffort`, text events and cadence is **not established**.
- **Ownership = `createdBy.firebaseUid` equals the rider's uid.** That is the bundle's own test for showing Edit and Delete. "My Collections" mixes the rider's created Workouts, favourites (collection slug `favourite`) and connected-app Workouts (TrainingPeaks, Intervals.icu…). The slug or filter for "only the Workouts I made" is **not established**.
- **Limits found:** name at most 200 characters, at most 3 tags (training-effect slugs), at least 1 segment, total at least 30 s, start and end targets 0–300 (% FTP; the UI clamps to 10–300), cadence 0–300 rpm, access `PRIVATE` (the default) or `PUBLIC`, and a **required `recommendedRouteId`**. No count, length or rate limits are published anywhere.

## 1. Routes

All routes are on `https://riders.rouvy.com`. Remix / React Router 7 conventions apply, as in [spec-m1 §6](../spec-m1.md#6-rouvy-client): a loader `GET <path>` has a single-fetch twin `GET <path>.data`, and an action is a `POST` to the route.

The table comes from the archived route manifest. "Loader" and "Action" are the manifest's own flags for each route.

| What | Route (path) | Manifest route id | Loader | Action | Confidence |
|---|---|---|---|---|---|
| Workouts home (curated rows + **My Collections**) | `/workouts` | `routes/_main.workouts._index` | yes | no | High |
| Search the catalogue | `/workouts/search` | `routes/_main.workouts.search` | yes | no | High |
| One collection (favourites, created, connected apps…) | `/workouts/collections/:id` | `routes/_main.workouts.collections.$id` | yes | no | High |
| **Read one Workout** | `/workouts/:id` | `routes/_main.workouts.$id` | yes | **yes (delete)** | High (route) / Medium (action = delete) |
| Workout profile as an image (for download) | `/workouts/:id/content` | `routes/_main.workouts.$id_.content` | yes | no | Medium |
| **Create** (also "Duplicate and Edit" via `?from=<id>`) | `/workouts/create` | `routes/_main.workouts.create` | yes | **yes** | High |
| **Edit** | `/workouts/:id/edit` | `routes/_main.workouts.$id_.edit` | yes | **yes** | High |
| **Import a file** | `/resources/workout-upload` | `routes/resources.workout-upload` | no | **yes** | High |
| Favourite on/off (a collection toggle) | `/resources/toggle-workout-collection` | `routes/resources.toggle-workout-collection` | yes | yes | High |
| Small workout card for another user | `/resources/workout/user-detail` | `routes/resources.workout.user-detail` | yes | no | Low (purpose guessed from its name) |
| Session refresh the creator calls just before saving | `/resources/user/refresh-session` | `routes/resources.user.refresh-session` | yes | no | Medium |

### List the rider's own Workouts

- No single "my Workouts" route exists. The **Workouts home** loader returns a `myCollections` list, items keyed by `slug`, next to `featuredWorkouts`, `latestWorkouts` and the training plans. Each collection opens at `/workouts/collections/:id`. That page's loader returns `collection.{itemsCount, workouts[]}` plus `sortingCriteria.{orderBy, orderDir}`. The sort keys are `DURATION`, `DIFFICULTY` and `LATEST`, the directions `ASC` and `DESC`. (Bundle, Medium.)
- The help centre says the same thing in user terms: "My Collections holds the workouts you created, the ones you marked as favourites, and the workouts that come in from other apps connected to ROUVY" ([Workouts in ROUVY](https://support.rouvy.com/hc/en-us/articles/33398875835921-Workouts-in-ROUVY)). (High.)
- **Unknown:** the slug of the "created by me" collection, whether imported files land in it or somewhere else, how it paginates (the collection page has no pager in the 2025 bundle, which suggests it returns everything in one response), and its sort parameters on the wire. → #75.

### Read one Workout

- `GET /workouts/:id` (`.data` for the payload). The page reads `workout.{id, name, description, segments[], segmentType, durationType, isDistance, routeGeometry, createdBy.{firebaseUid, username}, if, …}` plus `userMetrics.{userFtp, userWeight, powerZones}` and a page-level `canEdit` flag. (Bundle, Medium for field completeness.)
- Workout ids are **numeric** (archived public links such as `/workouts/17` and `/workouts/2702111`, from the [Wayback CDX index](https://web.archive.org/cdx/search/cdx?url=riders.rouvy.com/workouts*)). (High.)
- The `/workouts/:id/edit` loader returns `workout`, `route`, `trainingEffectsTags`, `userFtp`, `userWeight` and `userPowerZones`, all the creator needs to pre-fill. (Bundle, High.)

### Create

- The creator page `/workouts/create` posts its form **to itself**. The form is a plain `method="post"` form. On submit, the app first calls `GET /resources/user/refresh-session`, then calls the **native** `form.submit()`. That native call bypasses Remix's client-side fetch, so the wire request is probably a **regular `application/x-www-form-urlencoded` document POST to `/workouts/create`** (not `/workouts/create.data`), answered by a redirect. (Bundle, Medium. **The exact request, its encoding and its response are the first thing #75 should confirm.**)
- Form fields (see [§2](#2-wire-shape)): `name`, `description`, `tags` (comma-separated), `access`, `recommendedRouteId`, `segments` (a JSON string), `instructions` (a JSON string).
- **Duplicate and Edit** opens `/workouts/create?from=<workoutId>`. It copies any Workout, catalogue ones included, into a new Workout. It is offered only for Workouts that are % FTP plus time-based. (Bundle, High. Also the help centre: "Duplicate and Edit copies a workout into the workout creator".)

### Edit

- `/workouts/:id/edit`, same editor and same form fields, posting to itself. (Bundle, High for the route, Medium for the wire request, as for create.)
- The **Edit** menu entry appears only when the page's `canEdit` is true **and** the Workout is owned by the rider **and** it is % FTP **and** time-based. (Bundle, High.) Whether the server enforces the same rule on the action is **not established**.

### Delete

- On the Workout page, the **Delete** entry opens a confirmation dialog whose form posts to `/workouts/:id` with a single hidden field `id`. It sends no `intent` field, so the `/workouts/:id` action's only job appears to be deletion. (Bundle, Medium.)
- Delete appears when `canEdit` is true and the rider owns the Workout. Unlike Edit, it **does not** require % FTP or time-based. (Bundle, High.)
- **Unknown:** the response (redirect to `/workouts`?), whether deletion is soft, and what happens to past Activities whose `workoutId` points at the deleted Workout. → #75.

### Import (upload) route

- `POST /resources/workout-upload`, **multipart/form-data, one field `file`**, sent with a Remix fetcher (so the request probably goes to the single-fetch `.data` variant). On success the response data carries **`workoutId`**, and the dialog links to `/workouts/<workoutId>`. Without a `workoutId`, the dialog shows a generic "import error" with a retry. (Bundle, High for route, field and `workoutId`. Medium for the exact URL suffix and the error shape.)
- The client checks the filename suffix against `.erg`, `.mrc` and `.zwo` before sending. (Bundle, High.)
- Both the help centre and the bundle place it on the Riders Portal: an **Import from file** button at the top of the Workouts tab. (High.)
- So **an upload route exists**, and an MCP tool could hand it a ZWO the model wrote, instead of building Rouvy's segment JSON. Trade-offs in [§5](#5-implications-for-77-and-78).

## 2. Wire shape

All from the 2025 bundle. The **write** shape comes from the creator's own validation schema (High that the client enforces it, Medium that the server accepts exactly this). The **read** shape comes from what the pages consume (Medium).

### Enumerations (Rouvy's own values)

| Concept | Values | Notes |
|---|---|---|
| Segment kind (`intervalType`) | `CONSTANT`, `RAMP`, `FREE_RIDE` | The creator's UI calls them *sustain*, *build* (ramp up), *recover* (ramp down) and *free*. A ramp's direction is just `start > end`. |
| Target kind (`primaryType` on segments, `segmentType` on the Workout) | `FTP`, `POWER`, `WKG` | `FTP` = % FTP, `POWER` = watts (presumably what `.erg` imports become), `WKG` = W/kg. **The creator only writes `FTP`.** |
| Duration kind (`durationType`) | `TIME`, `DISTANCE` | The creator only writes `TIME`, in seconds. `DISTANCE` exists, probably for route-bound official Workouts. |
| Secondary target (`secondaryType`) | `CADENCE` | The only secondary kind. Set when a cadence range is present. |
| Visibility (`access`) | `PRIVATE`, `PUBLIC` | `PRIVATE` is the creator's default. |

There is **no heart-rate target and no slope target** in the structured model. Slope Control and Power Control are free-form ride modes, not saved Workouts ([Slope Control](https://support.rouvy.com/hc/en-us/articles/37560539321489-Slope-Control-Workout-Mode), [Power Control](https://support.rouvy.com/hc/en-us/articles/27703651802513-Power-Control-Workout-Mode)). Heart-rate *zones* shown on segments are derived from power, for display. (High.)

### Write shape (create and edit form)

- `name`: string, **≤ 200 characters**.
- `description`: string, optional.
- `tags`: up to **3** training-effect slugs, sent as one comma-separated string. The valid slugs come from the loader's `trainingEffectsTags`. The help centre lists training-effect categories such as endurance, sweet spot/tempo, threshold, VO2 max, anaerobic and sprinting ([Types of Workouts](https://support.rouvy.com/hc/en-us/articles/33778911571729-Types-of-Workouts)), but the slugs themselves are **unknown**.
- `access`: `PRIVATE` or `PUBLIC`.
- `recommendedRouteId`: string, **required**. Every Workout carries a default route. Which route id to send when the model doesn't pick one is **unknown** (the loader supplies a default `route`).
- `segments`: a JSON-encoded array, **at least 1 item, total duration ≥ 30 s**. Each item has:
  - `duration`: number of seconds, ≥ 1;
  - `intervalType`: `CONSTANT` | `RAMP` | `FREE_RIDE`;
  - `primaryType`: `FTP` in practice (the schema accepts any of the three kinds);
  - `primaryStart`, `primaryEnd`: numbers 0–300 (% FTP). The input fields clamp to 10–300. A free-ride segment is written with value 0. A constant segment has start = end;
  - `secondaryMin`, `secondaryMax`: optional cadence range in rpm (the UI clamps to 0–300);
  - `secondaryType`: `CADENCE` when a cadence range is set, otherwise null.
- `instructions`: a JSON-encoded array of on-screen text cues, each with `text`, `durationFromStart` (seconds from the Workout start) and `showDuration` (seconds on screen). The creator refuses to save a cue with empty text.

### Read shape (Workout page / editor pre-fill)

- The Workout: `id` (numeric), `name`, `description`, `trainingEffects` (tags), `access`, `segmentType` (target kind), `durationType`, `isDistance`, `createdBy.{firebaseUid, username}`, `instructions[]`, `segments[]`, plus derived numbers (IF, TSS, coins, max/min % FTP), the recommended route and its geometry.
- Read segments use **`valueStart` / `valueEnd`** where the write form uses `primaryStart` / `primaryEnd`. They also carry `intervalType`, `duration`, `secondaryMin` and `secondaryMax`. A mapper between the two names is needed. (Medium.)
- Activities link back to Workouts: every Activity list row already carries `workoutId` and a `training` kind such as `WORKOUT` or `WORKOUT_FTP_TEST` ([spec-m1 Appendix A](../spec-m1.md#activity-list)). (High.)

### Not established about the shape

- Whether the server recomputes IF, TSS and coins, or trusts the client (the creator computes NP, IF and TSS client-side).
- Whether segment and cue ids exist server-side (the editor makes up local ids).
- Whether a `POWER`- or `WKG`-typed Workout (e.g. from an ERG import) can be **written** through the create and edit actions, or only through import.

## 3. Import formats and what is lost

**Accepted:** `.zwo`, `.erg`, `.mrc` ([Workouts in ROUVY](https://support.rouvy.com/hc/en-us/articles/33398875835921-Workouts-in-ROUVY): "File import accepts .mrc, .erg and .zwo files"). The bundle's upload dialog checks the same three suffixes. **FIT workout files are not accepted** for upload. (High.)

**Other ways in:** Workouts from connected apps (TrainingPeaks, Intervals.icu, TrainerRoad, Final Surge, TriDot, Xert, Humango, CoachCat, Xhale…) arrive on their own, with no file ([Workouts in ROUVY](https://support.rouvy.com/hc/en-us/articles/33398875835921-Workouts-in-ROUVY), [TrainingPeaks](https://support.rouvy.com/hc/en-us/articles/14771353823121-ROUVY-and-TrainingPeaks), [Intervals.icu](https://support.rouvy.com/hc/en-us/articles/35523188955793-ROUVY-and-Intervals-icu)). TrainingPeaks only sends bike workouts built from **duration and % FTP**; heart-rate, pace and RPE workouts are dropped without a message. That fits the model in §2. (High.)

**ZWO, the format the rider uses today.** ZWO has no official spec. The de facto reference is [h4l/zwift-workout-file-reference](https://github.com/h4l/zwift-workout-file-reference/blob/master/zwift_workout_file_tag_reference.md). Mapping its elements onto Rouvy's model:

| ZWO element | Rouvy model | What survives | Confidence |
|---|---|---|---|
| `SteadyState` / `SolidState` (`Power`, fraction of FTP) | `CONSTANT`, % FTP | Survives (×100) | High (model) / Medium (importer behaviour) |
| `Warmup`, `Cooldown`, `Ramp` (`PowerLow` → `PowerHigh`) | `RAMP` | Survives. Ramp support on ZWO import was added in **4.0.4** ([Changelog](https://support.rouvy.com/hc/en-us/articles/360018747798-Changelog): "support for Free Ride and Ramp Up/Down segments… when importing ZWO files or creating workouts in the Workout Creator") | High |
| `FreeRide` / `Freeride` | `FREE_RIDE` | Survives (same changelog entry). `FlatRoad` and `ftptest` flags have no equivalent | High / Medium |
| `IntervalsT` (`Repeat`, `OnDuration`, `OffDuration`, `OnPower`, `OffPower`) | — | **Repeat structure lost**: Rouvy has no repeat type, so it can only be flattened into 2×`Repeat` segments | High that the structure is lost; Medium that the import succeeds |
| `MaxEffort` | — | No matching kind (free ride is the closest) | Unknown |
| `Cadence`, `CadenceLow` / `CadenceHigh`, `CadenceResting` | `secondaryMin` / `secondaryMax` | Probably survives as a range. A single `Cadence` value presumably becomes min = max. `CadenceResting` on interval recoveries is unclear | Low |
| `textevent` (`timeoffset`, `message`, `duration`) | `instructions[]` (`durationFromStart`, `text`, `showDuration`) | The model can hold them, but whether the importer maps them is **unknown** | Low |
| `name`, `description` | `name`, `description` | Probably | Low |
| `tags`, `category`, `author`, `sportType`, `ftpOverride`, `pace`, run/swim workouts | — | Probably lost. Rouvy tags are a closed set of training-effect slugs, and Rouvy is bike-only | Low |
| — | `recommendedRouteId`, `access` | Not in ZWO: the import must pick defaults (route and visibility unknown) | Unknown |

**ERG and MRC.** CompuTrainer-era text formats: a header, then a table of time (decimal minutes) against **watts** (ERG) or **% FTP** (MRC), with ramps made by linear interpolation between points and optional course text ([TrainerRoad's ERG/MRC guide](https://support.trainerroad.com/hc/en-us/articles/201944204-Creating-a-Workout-from-an-ERG-or-MRC-File), [`sportloop/mrc` parser](https://github.com/sportloop/mrc)). Neither format has a repeat, cadence or free-ride construct. ERG's absolute watts presumably import as `POWER`-typed Workouts, which the web creator then **cannot edit** (§1). (Medium.)

**Third-party claims that were not adopted:** a TrainerDay FAQ says Rouvy "does not support ramps", which predates 4.0.4. A ctyeh.com guide says ZWO only. Both conflict with Rouvy's own help centre, so they are ignored.

## 4. Ownership and the different kinds of Workout

- **The ownership test in the web app:** a Workout is the rider's when `createdBy.firebaseUid` equals the rider's Firebase uid, the same `uid` M1 already holds per Session. The bundle uses exactly that test to decide whether to show Delete, and adds "% FTP and time-based" for Edit. (High as client logic. Whether the server checks ownership on the actions is **not established**, and our client must check ownership itself before any write anyway.)
- **Catalogue / official Workouts:** created by Rouvy accounts, so `createdBy` is not the rider. The "latest official workouts" row and the search option "include non-official workouts" ([Workouts in ROUVY](https://support.rouvy.com/hc/en-us/articles/33398875835921-Workouts-in-ROUVY)) show that riders' **public** Workouts also appear in search. (High.)
- **Favourites:** a collection with slug `favourite`, toggled through `POST /resources/toggle-workout-collection` (fields `workoutId`, `collectionSlug`, `containsWorkout`). Favouriting does not copy the Workout, so `createdBy` stays the author. (High.) Out of scope for M3, but a favourited Workout must never look "mine".
- **Connected-app Workouts** (TrainingPeaks, Intervals.icu, …): they appear as their own collections or rows. Whose uid ends up in their `createdBy`, and whether the web app lets the rider delete them, is **unknown**. If they carry the rider's uid, the ownership test alone would let us edit Workouts that the next sync overwrites. → #75.
- **Coach Workouts:** no first-party source describes a separate coach channel on the web. "Coach" Workouts seem to arrive through connected apps (TrainingPeaks, Final Surge, …). (Low.)
- **Imported files:** presumably owned by the rider (they get a fresh `workoutId` and the rider can open them). Which collection they land in is **unknown**.

## 5. Implications for #77 and #78

These are for the grilling tickets to decide; they are not decisions.

- **Two ways to create a Workout:** (a) structured create through `/workouts/create`, our step JSON mapped to Rouvy's segment JSON; (b) **file import** through `/resources/workout-upload`, with the server writing a ZWO. (a) gives full control over name, tags, access, route and cues, and keeps every Workout editable in Rouvy's creator, but it relies on the least certain wire request (the native form POST). (b) matches what the rider does today and returns a `workoutId` directly, but it can't edit (no "replace by upload" route exists), picks its own defaults for route and visibility, and its ZWO coverage (MaxEffort, text events, cadence) is unknown. **Edit has to go through the structured action either way.**
- **Step schema:** Rouvy's model is flat (constant / ramp / free ride, % FTP, seconds, optional cadence range, timed text cues). A repeat block in our schema is fine as sugar, but it is flattened before sending and won't round-trip: a read returns the flat list.
- **Write safety (#78):** check ownership with `createdBy.firebaseUid === uid` on a fresh read before every edit and delete; refuse anything that isn't % FTP plus time-based for edit, as Rouvy's own UI does; delete is a POST to the Workout's own page route, so a mis-built URL is dangerous; keep `access = PRIVATE` unless the rider asks otherwise (a `PUBLIC` Workout shows up in other riders' searches).

## 6. What public sources could NOT establish (for #75)

1. **Whether the 2025 routes still hold in the current build** (`bn=303`). Every route and field above comes from a July 2025 bundle.
2. **The exact create and edit request:** URL (`/workouts/create` or `.data`), encoding, the role of the `refresh-session` call, response (redirect target, new id), and the validation-error shape.
3. **The delete request's response** and whether deletion is soft. What Activities whose `workoutId` points at a deleted Workout show afterwards.
4. **The "created by me" collection:** its slug, whether imports land in it, pagination, and the decoded shape of `/workouts` and `/workouts/collections/:id` payloads.
5. **The full decoded shape of `/workouts/:id.data`**, including segment field names on read (`valueStart`/`valueEnd`), the `canEdit` rule, and how `POWER`/`WKG`/`DISTANCE` Workouts look.
6. **Server-side enforcement:** whether the actions reject non-owned ids, non-FTP edits, out-of-range values or names over 200 characters, and with which status codes and shapes.
7. **ZWO import fidelity:** `IntervalsT` flattening, `MaxEffort`, cadence, text events, name and description. Default route and visibility of an imported Workout. The upload's error shape and size limit.
8. **Connected-app Workouts:** `createdBy` and editability.
9. **Training-effect tag slugs**, and a sensible default `recommendedRouteId`.
10. **Limits:** a cap on the number of Workouts per rider, segments per Workout or total length, and any rate limit on writes. Rouvy publishes none.

## Sources

- Rouvy help centre (read through the public Zendesk JSON API): [Workouts in ROUVY](https://support.rouvy.com/hc/en-us/articles/33398875835921-Workouts-in-ROUVY) (updated 2026-10-26), [Types of Workouts](https://support.rouvy.com/hc/en-us/articles/33778911571729-Types-of-Workouts), [Slope Control Workout Mode](https://support.rouvy.com/hc/en-us/articles/37560539321489-Slope-Control-Workout-Mode), [Power Control Workout Mode](https://support.rouvy.com/hc/en-us/articles/27703651802513-Power-Control-Workout-Mode), [ERG Mode Switch for Workouts](https://support.rouvy.com/hc/en-us/articles/40289751085201-ERG-Mode-Switch-for-Workouts), [Changelog](https://support.rouvy.com/hc/en-us/articles/360018747798-Changelog) (4.0.4: ramp and free-ride segments on ZWO import), [ROUVY and TrainingPeaks](https://support.rouvy.com/hc/en-us/articles/14771353823121-ROUVY-and-TrainingPeaks), [ROUVY and Intervals.icu](https://support.rouvy.com/hc/en-us/articles/35523188955793-ROUVY-and-Intervals-icu).
- Rouvy blog: [How to Create a Workout](https://rouvy.com/en/blog/how-to-create-a-workout) (% FTP intensities, optional cadence per block, name, description, tags, private/public, Duplicate and Edit; it doesn't mention deletion, import or limits). The web creator links to this post from its tutorial.
- Rouvy's public web-app bundle as archived by the Wayback Machine: route manifest [`manifest-1ba230a5.js`](https://web.archive.org/web/20250701181659/https://riders.rouvy.com/assets/manifest-1ba230a5.js) (2025-07-01), and the route chunks for `/workouts`, `/workouts/:id`, `/workouts/create`, `/workouts/:id/edit`, `/workouts/collections/:id` and the shared workout-editor and workouts modules (2025-07-02). Read for route names, form fields, enums and validation rules only. Nothing is copied into the repo.
- Wayback CDX index of [`riders.rouvy.com/workouts*`](https://web.archive.org/cdx/search/cdx?url=riders.rouvy.com/workouts*): numeric Workout ids in public links.
- ZWO: [h4l/zwift-workout-file-reference](https://github.com/h4l/zwift-workout-file-reference/blob/master/zwift_workout_file_tag_reference.md) (community reference built from Zwift's own files; Zwift publishes no spec).
- ERG/MRC: [TrainerRoad, Creating a Workout from an ERG or MRC File](https://support.trainerroad.com/hc/en-us/articles/201944204-Creating-a-Workout-from-an-ERG-or-MRC-File), [`sportloop/mrc`](https://github.com/sportloop/mrc).
- This repo: [spec-m1 §6 and Appendix A](../spec-m1.md#appendix-a-rouvy-web-api) (Activity rows carry `workoutId` and `training`), branch `research/prior-art` (no community client implements Workout routes; re-checked 2026-10-26: `mikejhill/home-assistant-rouvy` still has none).
