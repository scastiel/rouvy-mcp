// Turns a raw `/activity/<id>.data` capture into a committable fixture:
// decode (turbo-stream v2), keep only the Activity's own data, replace everything that
// identifies the rider, cut the long arrays short, re-encode.
//
//   node scripts/redact-activity-detail.mjs <raw capture> test/fixtures/activity-<name>.data <fixture number>
//
// Never commit the raw capture.
import { randomInt, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { decode, encode } from "turbo-stream";

const [input, output, number = "0"] = process.argv.slice(2);
if (!input || !output) throw new Error("usage: redact-activity-detail.mjs <raw> <fixture> [fixture number]");

// Keep in sync with DETAIL_ROUTE in src/rouvy/schemas.ts.
const ROUTE = "routes/_main.activity.$id";
// Same idea as the list fixture: a random, unrecorded shift of 60–180 days.
const SHIFT_MS = -randomInt(60 * 86_400, 180 * 86_400) * 1000;
// Kept short: enough to show the shape, not the Activity.
const KEEP_POINTS = 10;
// Timeseries keys holding latitude and longitude (Appendix A): emptied, they'd locate the route.
const POSITION_KEYS = new Set(["18", "19"]);

const raw = await readFile(input);
const { value, done } = await decode(new Blob([raw]).stream());
const data = await resolveDeferred(value[ROUTE].data);
await done;
const { activity } = data;

const start = new Date(new Date(activity.startUTC).getTime() + SHIFT_MS);
const id = `${activityIdStamp(start)}-fixture${number}`;
// Segment ids are Rouvy's, but they'd tie the fixture to a real route: give them new ones,
// consistently between the route's segments and the passes.
const segmentIds = new Map();
const segmentId = (real) => segmentIds.get(real) ?? segmentIds.set(real, randomUUID()).get(real);

const redacted = {
  [ROUTE]: {
    data: {
      activity: {
        id,
        title: `Fixture Activity ${number}`,
        training: activity.training,
        startUTC: start.toISOString(),
        startDateDisplay: start.toUTCString(),
        coins: activity.coins,
        experience: activity.experience,
        trainingScore: activity.trainingScore,
        images: [],
        user: {
          firebaseUid: "fixture-uid",
          username: "fixture-rider",
          firstName: "Fixture",
          lastName: "Rider",
          gender: "UNKNOWN",
          countryCode: "XX",
          avatar: "https://example.invalid/avatar.jpg",
          careerBadgeUrl: "https://example.invalid/badge.png",
          ageGroup: "00-00",
          // The Activity snapshot: kept as is, it's what get_activity reports.
          FTP: activity.user.FTP,
          weightKg: activity.user.weightKg,
          maxHr: activity.user.maxHr,
          zones: activity.user.zones,
        },
        total: activity.total,
        routeEstimatedTimeSec: activity.routeEstimatedTimeSec,
        routeId: `fixture-route-${number}`,
        workoutId: activity.workoutId == null ? null : `fixture-workout-${number}`,
        routeThumbnail: `https://example.invalid/route-${number}.png`,
        checkStatus: activity.checkStatus,
        failedValidators: activity.failedValidators,
        drafting: activity.drafting,
        eventSessionId: activity.eventSessionId == null ? null : `fixture-event-${number}`,
        executionScore: activity.executionScore,
        rateOfPerceivedExertion: activity.rateOfPerceivedExertion,
        laps: activity.laps,
        // Only the pass's own numbers: leaderboards name other riders, positions and trophies place the rider.
        segmentsPasses: activity.segmentsPasses.map((pass) => ({
          id: segmentId(pass.id),
          elapsedTimeSeconds: pass.elapsedTimeSeconds,
          avgPowerWatts: pass.avgPowerWatts,
          avgSpeedMetersPerSecond: pass.avgSpeedMetersPerSecond,
          avgHeartRateBPM: pass.avgHeartRateBPM,
        })),
        timeseries: activity.timeseries.map((series) => ({
          ...series,
          values: POSITION_KEYS.has(String(series.key)) ? [] : series.values.slice(0, KEEP_POINTS),
        })),
        route: {
          id: `fixture-route-${number}`,
          name: `Fixture route ${number}`,
          // Only what names a segment pass; positions along the route would identify it.
          segments: (activity.route?.segments ?? []).map((segment, i) => ({
            id: segmentId(segment.id),
            name: `Segment ${i + 1}`,
            type: segment.type,
            distanceMeters: segment.distanceMeters,
            elevationMeters: segment.elevationMeters,
            averageGrade: segment.averageGrade,
          })),
        },
      },
      exportLink: data.exportLink == null ? null : `https://activities.virtualtraining.eu/export/activity_export_fit_${id}.fit`,
      // The current Rider settings, set far from the snapshot's so a test can tell if they're ever used.
      userFtp: 999,
      userMaxHr: 999,
      userData: { ftp: 999, weight: 999, zoneValues: {} },
      activityTotalTimeInSec: data.activityTotalTimeInSec,
      activityTotalDistance: data.activityTotalDistance,
      // Profile points without their position.
      geometry: (data.geometry ?? []).slice(0, KEEP_POINTS).map(({ distance, altitude, slope }) => ({ distance, altitude, slope })),
      currentUserUid: "fixture-uid",
      isOwner: data.isOwner,
    },
  },
};

const text = await new Response(encode(redacted)).text();
await writeFile(output, text);
console.log(`wrote redacted Activity ${id} to ${output}`);

async function resolveDeferred(v) {
  const settled = await v;
  if (Array.isArray(settled)) return Promise.all(settled.map(resolveDeferred));
  if (settled && typeof settled === "object" && Object.getPrototypeOf(settled) === Object.prototype) {
    return Object.fromEntries(await Promise.all(Object.entries(settled).map(async ([k, x]) => [k, await resolveDeferred(x)])));
  }
  return settled;
}

/** Rouvy ids start with the Activity's UTC start as YYMMDDhhmmss. */
function activityIdStamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    pad(date.getUTCFullYear() % 100) +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds())
  );
}
