// Turns raw `/workouts/collections/created.data` and `/workouts/<id>.data` captures (each fetched
// with its `_routes`) into committable fixtures: decode (turbo-stream v2), keep only the Workout
// data, replace everything that identifies the rider, the Workout or its route, re-encode.
//
//   node scripts/redact-workouts.mjs <raw created list> <raw Workout detail> <fixtures dir>
//
// Writes `workouts-created.data` and `workout-detail.data`. The detail must be one of the listed
// Workouts. Never commit the raw captures.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decode, encode } from "turbo-stream";

const [listInput, detailInput, outDir] = process.argv.slice(2);
if (!listInput || !detailInput || !outDir) throw new Error("usage: redact-workouts.mjs <raw list> <raw detail> <fixtures dir>");

// Keep in sync with WORKOUT_LIST_ROUTE and WORKOUT_DETAIL_ROUTE in src/rouvy/workout-schemas.ts.
const LIST_ROUTE = "routes/_main.workouts.collections.$id";
const DETAIL_ROUTE = "routes/_main.workouts.$id";
const UID = "fixture-uid";

const list = await routeData(listInput, LIST_ROUTE);
const detail = await routeData(detailInput, DETAIL_ROUTE);

// Workout ids become 100001, 100002… in list order, the same in both fixtures.
const ids = new Map(list.collection.workouts.map((w, i) => [w.id, String(100001 + i)]));
const fixtureId = (real) => {
  const id = ids.get(real);
  if (!id) throw new Error("the detail capture isn't one of the listed Workouts");
  return id;
};
const fixtureName = (real) => `Fixture Workout ${Number(fixtureId(real)) - 100000}`;

// The Rider settings Rouvy attaches to every Workout: replaced by round numbers.
const userMetrics = {
  userFtp: 250,
  userFtpSource: "MANUAL",
  userWeight: 70,
  userMaxHr: 190,
  estimateMaxHr: 190,
  powerZones: [55, 75, 90, 105, 120, 150],
  defaultPowerZones: [55, 75, 90, 105, 120, 150],
  heartRateZones: [60, 65, 75, 82, 89, 94],
  defaultHeartRateZones: [60, 65, 75, 82, 89, 94],
};

/** Only the WorkoutOverview fields Rouvy computes or the rider chose that say nothing about them. */
const overview = (w) => ({
  __typename: w.__typename,
  id: fixtureId(w.id),
  name: fixtureName(w.id),
  tss: w.tss,
  rtl: w.rtl,
  coinsForCompletion: w.coinsForCompletion,
  duration: w.duration,
  trainingEffects: w.trainingEffects,
  difficulty: w.difficulty,
  segments: w.segments,
  userMetrics,
  ...(w.recommendedRoute && { recommendedRoute: route }),
  segmentType: w.segmentType,
  brandingImages: [],
});

const route = { id: "200001", name: "Fixture route", thumbnail: "https://example.invalid/route.png" };

const redactedList = {
  [LIST_ROUTE]: {
    data: {
      collection: {
        slug: list.collection.slug,
        name: list.collection.name,
        collectionType: list.collection.collectionType,
        isEditable: list.collection.isEditable,
        itemsCount: list.collection.itemsCount,
        workouts: list.collection.workouts.map(overview),
      },
      sortingCriteria: list.sortingCriteria,
    },
  },
};

const w = detail.workout;
const redactedDetail = {
  [DETAIL_ROUTE]: {
    data: {
      workout: {
        ...overview(w),
        recommendedRoute: route,
        createdBy: { firebaseUid: UID, username: "fixture-rider" },
        if: w.if,
        description: "Fixture description",
        access: w.access,
        // Cue texts are the rider's words: kept as positions only.
        instructions: w.instructions.map((cue, i) => ({ ...cue, text: `Cue ${i + 1}` })),
        collection: [],
        routeCanBeChanged: w.routeCanBeChanged,
      },
      workoutFtp: detail.workoutFtp,
      workoutWap: detail.workoutWap,
      uid: UID,
      canEdit: detail.canEdit,
    },
  },
};

await write("workouts-created.data", redactedList);
await write("workout-detail.data", redactedDetail);

async function routeData(file, key) {
  const { value, done } = await decode(new Blob([await readFile(file)]).stream());
  const resolved = await resolveDeferred(value);
  await done;
  if (!resolved[key]) throw new Error(`${file} has no ${key}: capture it with its _routes`);
  return resolved[key].data;
}

async function write(name, payload) {
  await writeFile(join(outDir, name), await new Response(encode(payload)).text());
  console.log(`wrote ${join(outDir, name)}`);
}

async function resolveDeferred(v) {
  const settled = await v;
  if (Array.isArray(settled)) return Promise.all(settled.map(resolveDeferred));
  if (settled && typeof settled === "object" && Object.getPrototypeOf(settled) === Object.prototype) {
    return Object.fromEntries(await Promise.all(Object.entries(settled).map(async ([k, x]) => [k, await resolveDeferred(x)])));
  }
  return settled;
}
