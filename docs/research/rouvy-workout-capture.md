# Live capture: how Rouvy's web app manages Workouts

**Ticket:** [Capture the workout builder's requests in Rouvy's web app](https://github.com/scastiel/rouvy-mcp/issues/75)
**Map:** [Map: Rouvy Workouts — milestone 3 (read and write Workouts)](https://github.com/scastiel/rouvy-mcp/issues/73)
**Captured:** 2026-10-26, riders.rouvy.com build `bn=305` (manifest version `d5254c19`), in the rider's own logged-in browser through the Chrome DevTools MCP.
**Confirms or corrects:** [Rouvy's workout API: routes, format, ownership, edit and delete](https://github.com/scastiel/rouvy-mcp/issues/74) ([findings](https://github.com/scastiel/rouvy-mcp/blob/research/rouvy-workout-api/docs/research/rouvy-workout-api.md)), which read a July 2025 bundle.

Throwaway branch, never merged. Everything below is redacted: no ids, uids, tokens, cookies, emails or route names. Shapes are described in our own words; no Rouvy code is copied.

What was done: one Workout built in the creator (3 segments), edited, deleted; one small ZWO imported, read back, deleted. The rider's library was left as found (the `created` collection back to its 1 original item).

## Summary

| Operation | Request | Body | Response |
|---|---|---|---|
| List own | `GET /workouts/collections/created.data` | — | turbo-stream; `collection.workouts[]` with **full segments** |
| Read | `GET /workouts/:id.data` | — | turbo-stream; `workout` + `uid` + `canEdit` |
| Create | `POST /workouts/create` (form) | urlencoded fields (below) | redirect to `/workouts/:newId` |
| Edit | `POST /workouts/:id/edit` (form) | same fields as create | redirect to `/workouts/:id` |
| Delete | `POST /workouts/:id.data` (React Router action) | urlencoded `id=<id>` | **202**, then client goes to `/workouts` |
| Import | `POST /resources/workout-upload.data` | multipart, one `file` field | turbo-stream `{ error, missingUsername, workoutId }` |

Every 2025 route from the research ticket still holds. Corrections: delete is answered with 202 on the `.data` route, and deletion is **soft** (below).

## 1. List the rider's own Workouts

- The library page (`/workouts`) has a "My collections" row; the rider's own Workouts are the collection with slug **`created`** (`collectionType: "created"`, `isEditable: false`). Favourites are a separate collection with a per-rider slug.
- `GET /workouts/collections/created.data` returns `collection { slug, name, description, collectionType, isEditable, itemsCount, pictureUrl, workouts[] }` and `sortingCriteria { orderBy: "LATEST", orderDir: "DESC" }`.
- Each list item is a `WorkoutOverview` with `id` (numeric string), `name`, `tss`, `rtl`, `coinsForCompletion`, `duration` (s), `trainingEffects[]`, `difficulty` (`easy`/`medium`/…), **`segments[]`** (same shape as read), `userMetrics` (the rider's FTP/weight/zones, i.e. Rider settings), `recommendedRoute`, `segmentType: "FTP"`, `brandingImages`. So list alone is enough to show structure; read adds the rest.
- Pagination: not observed (1–2 items). Open.
- **ZWO imports land in `created`** (checked).

## 2. Read one Workout

`GET /workouts/:id.data`, route key `routes/_main.workouts.$id`. `data.workout` adds to the list item:

- `createdBy { firebaseUid, username }`, `description`, `access` (`PRIVATE`/`PUBLIC`), `if`, `instructions[]`, `collection[]`, `routeCanBeChanged`, `recommendedRoute { id, name, thumbnail }`.
- Siblings of `workout`: `uid` (the rider's Firebase uid), **`canEdit`**, `workoutFtp { min, max }`, `workoutWap`, `similarWorkouts`.

Segment (read):

```
{ duration: <s>, intervalType: "CONSTANT" | "RAMP" | "FREE_RIDE", type: "FTP",
  valueStart: <% FTP>, valueEnd: <% FTP>,
  secondaryType: "CADENCE" | null, secondaryMin: <rpm> | null, secondaryMax: <rpm> | null }
```

Instruction (read): `{ text, showDuration: <s>, durationFromStart: <s> }`, absolute from the Workout start.

**Ownership:** `createdBy.firebaseUid === uid` was true for the rider's Workouts and false for a catalogue Workout. **`canEdit` is not an ownership signal**: it was `true` on a public catalogue Workout the rider does not own (probably "may open the creator", e.g. via "Duplicate and edit"). Ownership must be decided by the uid comparison.

## 3. Create and edit

Both are **native HTML form posts** (`application/x-www-form-urlencoded`, not the `.data` route), to `/workouts/create` and `/workouts/:id/edit`. On success the server redirects to the Workout's page; the create redirect carries the new id. Fields, in order:

| Field | Value |
|---|---|
| `name` | text |
| `description` | text |
| `tags` | training-effect slug, e.g. `endurance` (repeated for several) |
| `access` | `PRIVATE` (default) or `PUBLIC` |
| `recommendedRouteId` | numeric id; the creator pre-fills a default route |
| `segments` | JSON array (below) |
| `instructions` | JSON array (`[]` when none) |

Segment (write), the names differ from read:

```
{ duration: <s>, intervalType: "CONSTANT" | "RAMP" | "FREE_RIDE",
  primaryStart: <% FTP>, primaryEnd: <% FTP>, primaryType: "FTP",
  secondaryMin: <rpm> | null, secondaryMax: <rpm> | null, secondaryType: "CADENCE" | null }
```

A free ride is sent as `FREE_RIDE` with `primaryStart = primaryEnd = 0`.

Read ↔ write mapping: `valueStart/valueEnd/type` ↔ `primaryStart/primaryEnd/primaryType`; `trainingEffects` ↔ `tags`. `difficulty`, `tss`, `if`, `rtl`, `coinsForCompletion` are computed by Rouvy.

**Tags** are a fixed list of 13 training effects shown in the creator: Mental health, Endurance, VO2 Max, Recovery, Climbing, Sweet spot/tempo, Threshold, Anaerobic, Strength, Cadence, Sprinting, Warm-Up, Cool-Down (slugs observed: `endurance`; the others are presumably lower-case/kebab, unconfirmed).

**Default route:** the creator pre-fills one recommended route for a new Workout; the rider can change it. We can reuse whatever route a Workout already has on edit; for create, we need a default (open: pick the creator's pre-filled one, or let the rider choose).

Not observed: the create request body itself (the page navigated before it could be recorded); it is assumed identical to edit's, which the shared form supports. Validation-error responses were not triggered. Edit is a **full replace** of segments and instructions (the whole arrays are sent).

## 4. Delete

- The Workout page's "…" menu → Delete → an in-app confirmation dialog → `POST /workouts/:id.data` with a single urlencoded field `id`, answered **202**; the client then navigates to `/workouts`.
- **Soft delete:** after deleting, the Workout disappears from `created`, but `GET /workouts/:id.data` **still returns it in full**, with no deleted flag, `canEdit: true` and the owner's uid. Checked on both deleted Workouts minutes later. So "deleted" means "removed from the library", and a read-back cannot confirm a delete; listing `created` can.

## 5. ZWO import

`POST /resources/workout-upload.data`, multipart, one part `file` (filename `*.zwo`, sent as `application/octet-stream`). Response `{ error: null, missingUsername: <bool>, workoutId }`; the dialog then links to the new Workout. Accepted extensions shown: `.erg`, `.mrc`, `.zwo`.

Fidelity, from a test file with every common ZWO element:

| ZWO element | Result in Rouvy |
|---|---|
| `name`, `description` | kept |
| `<tag>` | **dropped** (`trainingEffects: []`) |
| `Warmup` / `Cooldown` (PowerLow→PowerHigh) | kept as `RAMP`, % FTP (both directions) |
| `IntervalsT Repeat=3` | **flattened** to 6 `CONSTANT` segments |
| `SteadyState` | kept as `CONSTANT` |
| `FreeRide` | kept as `FREE_RIDE` |
| `MaxEffort` | **silently dropped** (no segment, no error; total duration shorter) |
| `Cadence="90"` (single value) | turned into a ±10 rpm range (80–100) |
| `CadenceResting` | ±10 range on the off segments |
| `CadenceLow`/`CadenceHigh` on SteadyState | **dropped** |
| `textevent` | kept as an instruction, absolute offset, `showDuration` defaulted to 15 s |
| visibility / route | `PRIVATE`, the default recommended route |

The imported Workout is owned by the rider and **editable** in the creator (Edit is offered), unlike the research ticket's guess about non-FTP files (only `.zwo` was tested).

## 6. What is still open

| Question (from the research ticket) | Status |
|---|---|
| 2025 routes still hold | **Yes**, all six |
| Exact create/edit request | **Edit captured**; create assumed identical. Validation errors not seen |
| Delete response, soft or hard | **202, soft** |
| "Created by me" slug, imports, pagination | **`created`**, imports land there; pagination not seen |
| Rouvy rejects writes to Workouts the rider doesn't own | **Not tested** (deliberately: it would mean attempting a write on someone else's Workout). `canEdit` can't be relied on |
| Connected-app Workouts' uid | **Not tested**: no connected app on this account |
| ZWO fidelity, route, visibility | **Captured** (table above) |
| Tag values, default route | **13 training effects**; the creator pre-fills a default route |
| Decoded read shape | **Captured** (section 2) |

Also noticed: these requests authenticate with the same `rouvy_session` cookie our client already builds for its Session (`src/auth/rouvy-session.ts`), so the write routes need no new auth. A refresh-session call before writing was not observed, contrary to the 2025 bundle.
