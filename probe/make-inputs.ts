// Builds full-size benchmark inputs from the redacted fixtures, so no real ride is needed:
// a 1 h synthetic Activity file, and the route detail fixture padded to a real detail's ~460 KB.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { FitBaseType, FitEncoder } from "fit-file-parser";
import { encode } from "turbo-stream";
import { decodeSingleFetch } from "../src/rouvy/turbo-stream.js";

const HOUR = 3600;
const out = new URL("./inputs/", import.meta.url);
mkdirSync(out, { recursive: true });

const encoder = new FitEncoder();
const start = FitEncoder.toFitTimestamp(new Date("2026-01-01T00:00:00Z"));
for (let sec = 0; sec < HOUR; sec++) {
  const wave = Math.sin(sec / 90);
  encoder.writeMessage(
    20,
    [
      { number: 253, size: 4, baseType: FitBaseType.Uint32, value: start + sec },
      { number: 7, size: 2, baseType: FitBaseType.Uint16, value: Math.round(200 + 60 * wave + (sec % 7)) },
      { number: 3, size: 1, baseType: FitBaseType.Uint8, value: Math.round(140 + 15 * wave) },
      { number: 4, size: 1, baseType: FitBaseType.Uint8, value: 85 + (sec % 5) },
      { number: 6, size: 2, baseType: FitBaseType.Uint16, value: Math.round((8 + wave) * 1000) },
      { number: 2, size: 2, baseType: FitBaseType.Uint16, value: Math.round((100 + 20 * wave + 500) * 5) },
      { number: 5, size: 4, baseType: FitBaseType.Uint32, value: sec * 800 },
    ],
    0,
  );
}
const fit = encoder.close();
writeFileSync(new URL("synthetic-1h.fit", out), fit);

// A real detail carries a per-second `timeseries` we never use but still have to decode.
const fixture = readFileSync(new URL("../test/fixtures/activity-route.data", import.meta.url));
const decoded = (await decodeSingleFetch(new Response(fixture).body!)) as Record<string, { data: Record<string, unknown> }>;
const route = decoded["routes/_main.activity.$id"]!;
route.data.timeseries = Object.fromEntries(
  Array.from({ length: 24 }, (_, key) => [String(key), Array.from({ length: HOUR }, (_, sec) => Math.round((sec * 37 + key * 101) % 9973) / 10)]),
);
const padded = await new Response(encode(decoded)).text();
writeFileSync(new URL("synthetic-detail.data", out), padded);

console.log(JSON.stringify({ fitBytes: fit.byteLength, detailBytes: padded.length }));
