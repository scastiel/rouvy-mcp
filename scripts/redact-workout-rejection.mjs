// Turns the HTML page Rouvy re-renders after rejecting a Workout form post into a committable
// fixture: only the action data's `status`, `error` and `fields` survive, streamed the way React
// Router streams them. The page's loader data (the rider's profile) and the echoed form
// (`initialValue`) are dropped.
//
//   node scripts/redact-workout-rejection.mjs <raw page> test/fixtures/workout-rejected.html
//
// Never commit the raw page.
import { readFile, writeFile } from "node:fs/promises";
import { decode, encode } from "turbo-stream";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("usage: redact-workout-rejection.mjs <raw page> <fixture>");

const html = await readFile(input, "utf8");
const chunks = [...html.matchAll(/streamController\.enqueue\(("(?:[^"\\]|\\.)*")\)/g)].map((m) => JSON.parse(m[1]));
const { value, done } = await decode(new Blob([chunks.join("")]).stream());
const actionData = await value.actionData;
done.catch(() => {});

const kept = Object.fromEntries(
  Object.entries(actionData).map(([route, { status, error, fields }]) => [route, { status, error, fields }]),
);
const stream = await new Response(encode({ loaderData: {}, actionData: kept, errors: null })).text();
await writeFile(
  output,
  "<!DOCTYPE html><html><head><title>Créer une séance d'entraînement | ROUVY</title></head><body>\n" +
    `<script>window.__reactRouterContext.streamController.enqueue(${JSON.stringify(stream)});</script>\n` +
    "<script>window.__reactRouterContext.streamController.close();</script>\n</body></html>\n",
);
console.log(`wrote ${output}`);
