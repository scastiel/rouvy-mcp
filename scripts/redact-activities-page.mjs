// Turns a raw `activities-pagination.data` capture into a committable fixture:
// decode (turbo-stream v2), replace everything that identifies the rider, re-encode.
//
//   node scripts/redact-activities-page.mjs <raw capture> test/fixtures/activities-page-0.data
//
// Never commit the raw capture.
import { randomInt } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { decode, encode } from "turbo-stream";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("usage: redact-activities-page.mjs <raw> <fixture>");

// Keep in sync with LIST_ROUTE in src/rouvy/schemas.ts.
const ROUTE = "routes/resources.activities-pagination";
// Shifts every Activity back by the same random amount (60–180 days, to the second) so order
// and gaps survive but real start times don't. Random and never written down: a committed
// shift could be added back.
const SHIFT_MS = -randomInt(60 * 86_400, 180 * 86_400) * 1000;

const raw = await readFile(input);
const { value, done } = await decode(new Blob([raw]).stream());
await done;
const page = value[ROUTE].data;

const activities = page.activities.map((activity, index) => {
  const start = new Date(new Date(activity.startUTC).getTime() + SHIFT_MS);
  return {
    ...activity,
    // Keeps Rouvy's 8-character suffix shape.
    id: `${activityIdStamp(start)}-fixture${index}`,
    title: `Fixture route ${index + 1}`,
    startUTC: start.toISOString(),
    startDateDisplay: start.toUTCString(),
    images: activity.images.map((_, i) => ({
      url: `https://example.invalid/activity-${index}-${i}.jpg`,
      thumbnailUrl: `https://example.invalid/activity-${index}-${i}-thumb.jpg`,
    })),
    user: {
      ...activity.user,
      firebaseUid: "fixture-uid",
      username: "fixture-rider",
      firstName: "Fixture",
      lastName: "Rider",
      gender: "UNKNOWN",
      countryCode: "XX",
      ageGroup: "00-00",
      avatar: "https://example.invalid/avatar.jpg",
      careerBadgeUrl: "https://example.invalid/badge.png",
    },
    routeId: `fixture-route-${index + 1}`,
    workoutId: activity.workoutId === null ? null : `fixture-workout-${index + 1}`,
    routeThumbnail: `https://example.invalid/route-${index + 1}.png`,
  };
});

const redacted = { [ROUTE]: { data: { ...page, activities } } };
const text = await new Response(encode(redacted)).text();
await writeFile(output, text);
console.log(`wrote ${activities.length} redacted Activities to ${output}`);

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
