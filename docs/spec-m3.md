# rouvy-mcp — Milestone 3 spec (Workouts)

**Status:** build-ready. Produced by the wayfinding map [Map: Rouvy Workouts — milestone 3 (read and write Workouts)](https://github.com/scastiel/rouvy-mcp/issues/73).
Each section links the tickets its decisions come from; the tickets hold the reasoning. This document is the source of truth: if the build shows a decision is wrong, change it here in the same PR.

M3 builds on [`spec-m1.md`](spec-m1.md) and [`spec-m2.md`](spec-m2.md). Everything there still holds unless a section here changes it. The paragraphs this spec changes carry a "Changed in M3" line pointing here.

Vocabulary is defined in [`GLOSSARY.md`](../GLOSSARY.md). New in M3: **Workout** (the plan, in the rider's library), **Step** (one stretch of a Workout with a single target) and **Cue** (text shown at a set time). A Workout is never an **Activity** (the ride). Rouvy's own words ("segment", "instruction", "training effect") appear only where this spec describes Rouvy's wire format.

---

## 1. Scope

The rider can **list, read, create, edit and delete their own Workouts** in Rouvy from any MCP client, through the shared `createServer()`, on **both** entry points: stdio and the hosted server (self-hosts and the Public instance alike).

This is the first time rouvy-mcp writes to Rouvy. Writes are limited to the rider's own Workouts (§2).

**Out of scope for M3**

- Scheduling Workouts onto Rouvy's training calendar.
- Rouvy's public Workout catalogue, favourites and coaches' Workouts: reading or writing them.
- Any write other than the rider's own Workouts: Activities, Rider settings, profile.
- Uploading ZWO/ERG/MRC files. Writes go through Rouvy's structured form route only (§4).
- Watts and W/kg targets, heart-rate targets, distance-based Steps.
- A route search tool.

Sources: [Map](https://github.com/scastiel/rouvy-mcp/issues/73).

## 2. Ground rules

M1's and M2's ground rules hold (the politeness charter, the honest UA, no secrets in logs, repo hygiene, the Hard stop), with one change:

- **"Read-only by construction" becomes "writes Workouts only".** The polite fetch layer refuses every non-GET request except an allow-list (§6.1): the three Workout write routes, plus the login and refresh POSTs from spec-m1 §4. Activities, Rider settings and the profile stay read-only by construction.
- **Writes happen only on the rider's request**, through a tool call the client can show as destructive (§4).
- **Never logged** (on top of M1's and M2's lists): Workout ids, names, descriptions, Step lists, Cue texts, and form bodies.

Sources: [Map Notes](https://github.com/scastiel/rouvy-mcp/issues/73), [Write safety in the Rouvy client](https://github.com/scastiel/rouvy-mcp/issues/78).

## 3. Rouvy Workout routes

All routes are on `riders.rouvy.com`, called with the same `rouvy_session` cookie and cookie jar as M1's routes (spec-m1 §6). Captured live on 2026-10-26 (build `bn=305`). Redacted shapes are in [Appendix A](#appendix-a-workout-endpoints).

| Operation | Route | Notes |
|---|---|---|
| List own | `GET /workouts/collections/created.data` | turbo-stream. The rider's own Workouts are the collection with slug `created`; items carry full segments. |
| Read | `GET /workouts/:id.data` | turbo-stream. `workout`, plus siblings `uid` and `canEdit`. |
| Default route | `GET /workouts/create.data` | The creator's loader, route key `routes/_main.workouts.create`. The pre-filled route is `route.id`. |
| Create | `POST /workouts/create` | Native form post, `application/x-www-form-urlencoded`. Success is a **302** with a relative `Location: /workouts/<newId>`. |
| Edit | `POST /workouts/:id/edit` | The same form fields as create. A **full replace** of segments and instructions. Success is a 3xx to `/workouts/:id`. |
| Delete | `POST /workouts/:id.data` | urlencoded `id=<id>`, answered **202**. **Soft:** the Workout leaves `created` but stays readable by id. |

**Form fields** (create and edit), in order: `name`, `description`, `tags` (**one** field, the training-effect slugs joined with commas), `access` (`PRIVATE` or `PUBLIC`), `recommendedRouteId`, `segments` (JSON), `instructions` (JSON).

**Field names differ between read and write:**

| Read (`workout`) | Write (form) |
|---|---|
| `segments[].valueStart` / `valueEnd` / `type` | `segments[].primaryStart` / `primaryEnd` / `primaryType` |
| `segments[].secondaryType` / `secondaryMin` / `secondaryMax` | same names |
| `trainingEffects[]` | `tags` |
| `instructions[] {text, showDuration, durationFromStart}` | same shape, as JSON |

`intervalType` is `CONSTANT`, `RAMP` or `FREE_RIDE` on both sides. `primaryType` is always `FTP` in M3. A free ride is written with `primaryStart = primaryEnd = 0`. `difficulty`, `tss`, `if`, `rtl` and `coinsForCompletion` are computed by Rouvy.

**Ownership signals:** `workout.createdBy.firebaseUid` compared with the Session's uid (Rouvy echoes it as the sibling `uid`). Rouvy's `canEdit` is **not** an ownership signal: it is `true` on catalogue Workouts too.

**Build-time discoveries** (record them here when found): the response to a form post that fails Rouvy's validation (assumed to be a 200 re-rendering the form), the default route's key in `/workouts/create.data`, and whether `created` paginates.

- **`_routes`** (build step 1): both reads honour `_routes=<route key>`, as M1's list does, and then carry only that route's data (about 2.5 KB instead of 17 KB, and no `root` with the rider's profile). The client always sends it.
- **The list overview has no `if` and no `access`** (build step 1): only a detail carries them, so `list_workouts` rows leave both out (§4) rather than read every Workout.
- **Pagination of `created`** (build step 1): not established. The maintainer's library holds a single Workout, and `created.data` takes no offset that the web app sends. The collection carries `itemsCount`: when it ever exceeds the number of Workouts returned, `list_workouts` says so in a note instead of hiding the rest.
- **The default route** (build step 2): `route.id` in the creator's loader data (`routes/_main.workouts.create`), next to `trainingEffectsTags` (the tag list, §5) and the rider's FTP.
- **Tags are one comma-joined field** (build step 2). The creator submits a single hidden `tags` input, and Rouvy's form schema splits a string on commas and turns anything else into `[]`. Repeated `tags` fields are therefore accepted with a 302 and **silently saved as no tags**. Rouvy doesn't check the slugs: only our enum does.
- **An edit that sends no tags keeps the old ones** (build step 2): `tags=` (what the creator sends with nothing selected) left both tags of a Workout in place. `update_workout` can't clear tags (§4).
- **A rejected form post** (build step 2), triggered by a 231-character name: **200 `text/html`**, the creator re-rendered. React Router streams the action's answer into the page (`streamController.enqueue(…)`, turbo-stream). Its `actionData["routes/_main.workouts.create"]` is `{status: "error", error: {<field>: [message]}, fields, initialValue}`, here `{name: ["String must contain at most 200 character(s)"]}`. *Rouvy rejected the write* carries `<field>: <message>` pairs and never `initialValue`, which echoes the input.
- **Rouvy's own form rules** (build step 2), read off the creator's bundle: `name` at most 200 characters (no minimum), at most 3 tags (any string), `primaryStart`/`primaryEnd` 0–500, every `duration` ≥ 1, at least 1 segment, at least 30 s in all. §5 is stricter or equal everywhere.
- **No `Origin` or extra header** is needed on the form posts (build step 2). The web app calls `GET /resources/user/refresh-session` before submitting. We don't: our GET-first reads (§6.2) cover a dead Session.

- **A delete answers 202 with a single-fetch redirect to `/workouts`** (build step 4). **But a Session's very first riders.rouvy.com request is also answered 202**, with a redirect back to the same page that only sets Rouvy's cookies: the action doesn't run. A cleanup script that deleted on a fresh Session got that 202, and the Workout stayed listed. Every write's GET first (§6.2) reads the Workout or the creator itself (never only from cache), so the POST is never a Session's first request, and the fresh-list check (§6.5) would catch it anyway.

All of the above was checked on 2026-10-26 with one create, one edit, one rejected create and two deletes on the maintainer's account, each named *rouvy-mcp contract — delete me*. `created` was left as found.

Sources: [Rouvy's workout API: routes, format, ownership, edit and delete](https://github.com/scastiel/rouvy-mcp/issues/74) ([findings](https://github.com/scastiel/rouvy-mcp/blob/research/rouvy-workout-api/docs/research/rouvy-workout-api.md)), [Capture the workout builder's requests in Rouvy's web app](https://github.com/scastiel/rouvy-mcp/issues/75) ([capture](https://github.com/scastiel/rouvy-mcp/blob/research/workout-capture/docs/research/rouvy-workout-capture.md)).

## 4. MCP tools

Five tools, following spec-m1 §5's conventions: snake_case names, JSON text results, errors as MCP tool errors (§8).

| Tool | Input | Output | Annotations |
|---|---|---|---|
| `list_workouts` | `limit?` (1–50, default 10), `offset?` (≥ 0, default 0) | newest first, compact rows `{id, name, duration_sec, tss, difficulty, tags, step_count}`, plus `has_more` (and a note if Rouvy counts more Workouts than it lists). **No Steps.** No `if` or `visibility`: Rouvy's list doesn't carry them (§3). | `readOnlyHint` |
| `get_workout` | `workout_id` | `{id, name, description, tags, visibility, duration_sec, tss, if, difficulty, route {id, name}, rider_ftp_w, steps, cues}` | `readOnlyHint` |
| `create_workout` | `name`, `description?`, `tags?`, `visibility?`, `route_id?`, `steps`, `cues?` | the saved Workout, read back (the `get_workout` shape) | not read-only, not destructive |
| `update_workout` | `workout_id`, plus optional `name`, `description`, `tags`, `visibility`, `steps`, `cues` | the saved Workout, read back | `destructiveHint` |
| `delete_workout` | `workout_id` | `{deleted: id, name}` and a note that Rouvy may keep the Workout readable by its id | `destructiveHint` |

- **`workout_id`:** a string of digits, as `list_workouts` returns it (`^\d{1,12}$`), so nothing else reaches a URL path.
- **Only owned Workouts** are ever listed, returned or written (§6.3). The owner is never exposed.
- **`rider_ftp_w`:** the rider's **current** FTP in watts, as Rouvy reports it on the Workout (`userMetrics.userFtp`), so Claude can turn "250 W" into % FTP. This is the one place current Rider settings are used. Activities still use their Activity snapshot only (spec-m1 §5).
- **Update semantics:** `steps`, when given, replace all Steps. Every other field that is left out (including `cues`) keeps its current value, taken from the read just before the write. The route is always kept. **Last write wins**: there is no concurrency guard, because Rouvy keeps no version to compare against.
  - **Tags can't be cleared** (§3): `tags: []` on a Workout that has tags is an input error ("give the tags to keep, or leave tags out"), sent before any POST, rather than a write Rouvy would silently ignore.
  - **Validation runs twice:** the given fields alone, before any request, and then the merged Workout, once the read has shown the real total for the Cues.
  - A Workout without a route (never seen) gets the creator's default route.
- **Route on create:** `route_id` when given; otherwise the creator's default route (§3). `route_id` accepts any id Claude saw on another Workout through `get_workout`.
- **Descriptions** of `update_workout` and `delete_workout` warn that a Workout synced from another app (TrainingPeaks, Intervals.icu…) may be overwritten by that app's next sync.

Sources: [Workout tool surface and step schema](https://github.com/scastiel/rouvy-mcp/issues/77), [Write safety in the Rouvy client](https://github.com/scastiel/rouvy-mcp/issues/78).

## 5. Step schema and validation

Our own JSON, sent through Rouvy's form route. **ZWO upload is never used**: it silently drops MaxEffort blocks, tags and SteadyState cadence ranges, and it can't edit.

```
step:
  {type: "steady",    duration_sec, ftp_pct, cadence?}
  {type: "ramp",      duration_sec, from_ftp_pct, to_ftp_pct, cadence?}
  {type: "free_ride", duration_sec, cadence?}
  {type: "repeat",    times, steps: [steady | ramp | free_ride]}   // input only
cadence: {min_rpm, max_rpm}
cue:     {at_sec, text, show_sec? = 15}
tags:    "mental-health" | "endurance" | "vo2-max" | "recovery" | "climbing"
       | "sweet-spot-tempo" | "threshold" | "anaerobic" | "strength" | "cadence"
       | "sprinting" | "warm-up" | "cool-down"        (at most 3)
visibility: "private" (default) | "public"
```

- **% FTP only**, integers 0–300.
- **`repeat` is input sugar.** The server flattens it in order (`times` × its Steps). No nesting: a `repeat` inside a `repeat` is an input error.
- **Reads return flat Steps** exactly as Rouvy stores them, so a `get_workout` result is valid `update_workout` input and round-trips. Repeats are never re-detected on read.
- **Cues use absolute times** (seconds from the Workout's start), as Rouvy stores them.
- **Tag slugs:** confirmed at build step 2. All thirteen are exactly the slugs the creator's loader lists in `trainingEffectsTags.tags[].slug` (§3), in this order.
- `public` is used only when the rider asks for it.

**Mapping to Rouvy** (§3): `steady` → `CONSTANT` with start = end = `ftp_pct`; `ramp` → `RAMP` from/to; `free_ride` → `FREE_RIDE` with 0/0; `cadence` → `secondaryType: "CADENCE"` with min/max (all three `null` without cadence); `cue` → `{text, showDuration: show_sec, durationFromStart: at_sec}`; `visibility` → `access`.

**Validation, before any request:**

- every duration an integer ≥ 1 s; the total (after flattening) ≥ 30 s;
- at least 1 Step after flattening;
- `ftp_pct`, `from_ftp_pct`, `to_ftp_pct`: integers 0–300;
- cadence 0–300 rpm, `min_rpm ≤ max_rpm`;
- `times` an integer ≥ 2;
- `name` 1–200 characters;
- at most 3 tags, each from the enum;
- each cue with `0 ≤ at_sec < total duration`, non-empty `text`, `show_sec ≥ 1`.

One **input error** lists **every** problem, each with its path (`steps[2].steps[0].ftp_pct`, `cues[1].at_sec`).

Sources: [Workout tool surface and step schema](https://github.com/scastiel/rouvy-mcp/issues/77), [Capture the workout builder's requests in Rouvy's web app](https://github.com/scastiel/rouvy-mcp/issues/75).

## 6. Write safety

### 6.1 The allow-list

- The polite fetch layer (spec-m2 §7) refuses any non-GET request that isn't on the allow-list, and **throws before sending**:
  - `POST https://riders.rouvy.com/workouts/create`
  - `POST https://riders.rouvy.com/workouts/<digits>/edit`
  - `POST https://riders.rouvy.com/workouts/<digits>.data`
  - the Firebase sign-in and refresh POSTs (spec-m1 §4).
- The Workout write methods live in their own module, apart from the read client.
- A test pins the allow-list, and another fails if a request with any other method or URL is attempted.

### 6.2 GET first, never retry the POST

- **Every write starts with a GET in the same Session**:
  - update and delete read the Workout through the ownership path (§6.3);
  - create reads the default route (§3) and the `created` list.

  Logged-out signals, Rouvy's cookie redirect and Cloudflare blocks therefore surface on the GET, before anything is written, and the GET gets M1's usual auth and 5xx handling.
- **The POST is never retried**: not on 5xx, not on a network error, not on a timeout, not on the logged-out signal. Such a failure is *outcome unknown* (§8).
- A 403 or 429 on a POST starts the usual cool-down (spec-m1 §7).

### 6.3 Ownership

A Workout is the rider's when **both** hold:

1. it is listed in the rider's `created` collection (so deleted Workouts are excluded), and
2. its `createdBy.firebaseUid` equals the Session's uid.

`get_workout`, `update_workout` and `delete_workout` check both. Anything else is *Workout not found*, with no hint that the Workout exists. Synced Workouts that pass the check are treated like any other.

### 6.4 Create and update

- The POST is sent with `redirect: "manual"`.
- **Create:** the new id is taken from the 3xx `Location` (`/workouts/<digits>`). Then the list cache is dropped and the Workout is read back through §6.3.
- **Update:** a 3xx to `/workouts/:id` is success, then the Workout is read back.
- A 200 (the form re-rendered, probably a validation failure) or a `Location` of another shape is *Rouvy rejected the write*, carrying whatever message can be decoded.

### 6.5 Delete

- After the 202, `created` is fetched **fresh**, bypassing the cache.
- If the Workout is gone, the result is `{deleted: id, name}`. If it's still listed, the result is *delete not confirmed*.

Sources: [Write safety in the Rouvy client](https://github.com/scastiel/rouvy-mcp/issues/78).

## 7. Budget and caching

- **Same queue, same rules:** writes use M1's single queue, with 1 s between requests and the shared cool-down. On the hosted server, they share M2's global polite layer, with one call in flight per rider. There is no separate write budget.
- **Cost:** `create_workout` ≈ 4 requests (default route, POST, list, read-back), about 4–5 s. `update_workout` ≈ 4 (list, read, POST, read-back). `delete_workout` ≈ 4 (list, read, POST, fresh list). `get_workout` ≈ 2. `list_workouts` ≈ 1.
- **Cache:**

| What | Lifetime |
|---|---|
| The rider's `created` list | 60 s, keyed by uid; dropped after any write that succeeded or whose outcome is unknown |
| Workout detail | not cached (read-backs must be fresh) |

Sources: [Write safety in the Rouvy client](https://github.com/scastiel/rouvy-mcp/issues/78).

## 8. Errors

M1's error kinds (spec-m1 §8) still apply. New kinds:

| Kind | When | Message gist |
|---|---|---|
| *Invalid Workout* | validation (§5) | every problem, with its path |
| *Workout not found* | the ownership check fails (§6.3) | "No Workout with this id in your library" |
| *Rouvy rejected the write* | a 200 or an unexpected redirect on a form post | Rouvy's message when decodable, else "Rouvy didn't accept the Workout" |
| *Outcome unknown* | a 5xx, network error or timeout on a POST | "Rouvy may or may not have saved this. Call `list_workouts` before trying again." |
| *Delete not confirmed* | the Workout is still in `created` after the 202 | "Rouvy answered but the Workout is still in your library" |
| *Unsupported Workout* | an owned Workout with a segment `type` other than `FTP` (watts or W/kg, from an imported file) | "This Workout has targets other than % FTP" |

A failure in the read-back after a successful POST says the Workout was saved ("call `list_workouts` to find it") rather than reading as if nothing was written.

**Outcome categories** in the operations log (spec-m2 §9): *Invalid Workout* is `invalid_input`. *Rouvy rejected the write* is `write_rejected` and *outcome unknown* is `outcome_unknown`. The other kinds are `rouvy_error`. A request refused by the allow-list (§6.1) is a bug, logged as `unexpected`.

Sources: [Write safety in the Rouvy client](https://github.com/scastiel/rouvy-mcp/issues/78).

## 9. Hosted server

Workout writes ship on the Public instance with M3, **with no flag**, on the same `createServer()` as stdio.

- **Consent:** the **required** risk checkbox on `/authorize` (spec-m2 §5) is reworded to cover writes. Draft, with final wording at build step 5: *"I'm connecting my own Rouvy account at my own risk. I let my MCP client read my rides and create, change and delete my own Rouvy Workouts when I ask. Rouvy's terms (§7.c, §14.a.vi) may not allow access like this, and Rouvy could restrict or close my account. I accept the Hard stop: …"*. The Art. 9 health-data checkbox is unchanged.
- **Grants:** `props` gains **`consentVersion: 2`** (spec-m2 §5, §6). A request on a Grant with a missing or older `consentVersion` is revoked on the spot (401, then `invalid_grant`), the same path as M2's terminal errors. The client re-runs OAuth and the rider sees the new wording. The next consent change bumps the version again.
- **Legal pages and paperwork:**
  - **`/privacy`:** Rouvy is "read from and, on your request, written to (your own Workouts only)", and the purpose adds managing the rider's own Workouts.
  - **Art. 30 record:** the purpose adds managing the rider's own Workouts on their request, and "read-only by construction" becomes "writes only the rider's own Workouts".
  - **DPIA:** a new risk, *a Workout overwritten or deleted by mistake*. Its mitigations are writes on request only, `destructiveHint` in clients, the ownership check, delete confirmation, and Rouvy keeping deleted Workouts readable by id. The rows that say "read-only" are reworded.
  - The legal basis is unchanged (consent).
- **Rouvy permission request** (spec-m2 §10):
  - **When:** it is sent **when M3 is live on the Public instance**, no longer when the beta opens.
  - **What it says:** reads, plus creating, editing and deleting the rider's own Workouts on their request, through the routes Rouvy's web app uses. "Read-only access" leaves the list of ways to recognise us.
  - **Outcomes:** unchanged, plus one rule. **"Yes, but no writes"** is a condition we can meet: a release removes the write tools from the Public instance and bumps `consentVersion` back to read-only wording. Self-hosts and stdio keep writes.
  - **Hard stop:** a block or a flat objection is still a Hard stop. No new tripwire.

Sources: [Workout writes on the hosted Public instance](https://github.com/scastiel/rouvy-mcp/issues/76).

## 10. Testing and drift

- **Fixtures:** redacted fixtures from the 2026-10-26 capture: the `created` list, one Workout detail, the urlencoded create/edit form body, the 3xx responses, and the delete 202. The redaction drops ids, uids, names and the route.
- **Unit tests:**
  - Step mapping both ways, and the read → write round-trip.
  - `repeat` flattening, and every validation rule (each error with its path).
  - The allow-list.
  - GET-first ordering, and no retry on a POST.
  - The ownership check: not in `created`, wrong uid, deleted-but-readable.
  - The create id read from `Location`, and the error paths (§8).
  - Cache drops after a write.
- **Hosted tests (offline):** a Grant without `consentVersion: 2` is revoked with a 401; a fresh Grant carries it.
- **`npm run contract:live -- --writes`** is maintainer-run, opt-in, and run before each release that touches Workouts. It creates a *rouvy-mcp contract — delete me* Workout, edits it, deletes it, and checks it's gone from `created`. It **cleans up even on failure**, deleting anything named with that prefix that it created. Without `--writes`, `contract:live` stays read-only and adds a `list_workouts` + `get_workout` check.
- **The daily canary stays read-only** and sends no POSTs. Drift in the write routes is caught by `contract:live --writes` before releases, and by riders' errors.

Sources: [Write safety in the Rouvy client](https://github.com/scastiel/rouvy-mcp/issues/78).

## 11. Build order

Vertical slices, each usable on its own. Turning them into implementation issues is a separate step after this spec.

1. **Read tools, released alone.** `list_workouts` and `get_workout`, the ownership check (§6.3), the 60 s list cache, the read fixtures. Still read-only; works on both entry points.
2. **The write boundary and `create_workout`.** The allow-list (§6.1), the write module, GET-first (§6.2), the Step schema with validation and mapping (§5), the default route, `Location` capture, read-back. Confirm the tag slugs and record the build-time discoveries in §3. Write fixtures.
3. **`update_workout`.** Kept metadata, full Step replace, read-back.
4. **`delete_workout` and `contract:live --writes`.** The fresh-list confirmation. Release stdio with all five tools.
5. **Hosted consent and paperwork.** The reworded checkbox, `consentVersion` with revocation, `/privacy`, the Art. 30 record and the DPIA. Must land before the Public instance runs a build with write tools.
6. **Deploy to the Public instance, then send the Rouvy permission request** (§9).

---

## Appendix A: Workout endpoints

Redacted, in our own words. `<id>` is a numeric Workout id and `<uid>` a Firebase uid. Full detail: [capture notes](https://github.com/scastiel/rouvy-mcp/blob/research/workout-capture/docs/research/rouvy-workout-capture.md).

**`GET /workouts/collections/created.data`**, route key `routes/_main.workouts.collections.$id`:

```
collection { slug: "created", collectionType: "created", isEditable, itemsCount,
             workouts: [WorkoutOverview { id, name, tss, rtl, duration, difficulty,
                                          trainingEffects[], segments[], userMetrics, … }] }
sortingCriteria { orderBy: "LATEST", orderDir: "DESC" }
```

**`GET /workouts/<id>.data`**, route key `routes/_main.workouts.$id`:

```
workout { …WorkoutOverview, createdBy { firebaseUid, username }, description,
          access: "PRIVATE" | "PUBLIC", if, instructions[], recommendedRoute { id, name, thumbnail },
          routeCanBeChanged }
uid, canEdit, workoutFtp { min, max }, workoutWap
segment (read): { duration, intervalType, type: "FTP", valueStart, valueEnd,
                  secondaryType: "CADENCE" | null, secondaryMin, secondaryMax }
instruction: { text, showDuration, durationFromStart }
```

**`POST /workouts/create`** and **`POST /workouts/<id>/edit`** (urlencoded):

```
name=…&description=…&tags=endurance&access=PRIVATE&recommendedRouteId=<id>
&segments=[{"duration":300,"intervalType":"CONSTANT","primaryStart":56,"primaryEnd":56,
            "primaryType":"FTP","secondaryMin":null,"secondaryMax":null,"secondaryType":null}, …]
&instructions=[]
→ 3xx Location: /workouts/<id>
```

**`POST /workouts/<id>.data`** (urlencoded `id=<id>`) → 202. The Workout leaves `created` and stays readable at `/workouts/<id>.data`.
