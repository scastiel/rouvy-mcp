import { parseActivityFile } from "../src/activity-file/parse.js";
import { parseActivityDetail } from "../src/rouvy/schemas.js";
import { decodeSingleFetch } from "../src/rouvy/turbo-stream.js";
import { bestEfforts, windowStats } from "../src/stats/window.js";
import { POWER_PEAKS } from "../src/tools/common.js";

/**
 * The two CPU-heavy things a tool call does, one per call so a host's per-invocation CPU time
 * (Workers observability) measures exactly one. Inputs come from make-inputs.ts.
 */
export async function benchDetail(detail: string) {
  const parsed = parseActivityDetail(await decodeSingleFetch(new Response(detail).body!));
  return { detailBytes: detail.length, hasExportLink: parsed.exportLink != null };
}

/** What get_activity_intervals (12 × 5 min) plus get_window_stats (whole ride) cost on a 1 h file. */
export async function benchActivityFile(fit: ArrayBuffer) {
  const { records } = await parseActivityFile(fit);
  const options = { channels: { power: true, heart_rate: true, cadence: true, speed: true }, ftp: 250 };
  const end = records.length;
  const splits = Array.from({ length: Math.ceil(end / 300) }, (_, i) => windowStats(records, i * 300, Math.min(end, (i + 1) * 300), options));
  const whole = windowStats(records, 0, end, options);
  const efforts = bestEfforts(records, 0, end, POWER_PEAKS);
  return { fitBytes: fit.byteLength, records: end, splits: splits.length, np: whole.np_w, efforts: Object.keys(efforts).length };
}

/** Wall time of a workload, for hosts whose clock advances during CPU work (not Workers). */
export async function timed<T>(work: () => Promise<T>): Promise<T & { ms: number }> {
  const start = performance.now();
  const result = await work();
  return { ...result, ms: Math.round((performance.now() - start) * 10) / 10 };
}
