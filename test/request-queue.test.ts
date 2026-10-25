import { describe, expect, it } from "vitest";
import { createRequestQueue } from "../src/rouvy/request-queue.js";
import { fakeClock } from "./server-harness.js";

/** A network where every request takes `durationMs` of virtual time, logging when each starts and ends. */
function slowNetwork(clock: ReturnType<typeof fakeClock>, durationMs: number, fail?: (url: string) => boolean) {
  const log: { url: string; start: number; end: number }[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    const start = clock.now();
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await Promise.resolve();
    clock.advance(durationMs);
    inFlight--;
    log.push({ url, start, end: clock.now() });
    if (fail?.(url)) throw new TypeError("fetch failed");
    return new Response("ok");
  }) as typeof globalThis.fetch;
  return { fetch, log, maxInFlight: () => maxInFlight };
}

describe("request queue", () => {
  it("sends one request at a time, across hosts, in the order asked", async () => {
    const clock = fakeClock();
    const network = slowNetwork(clock, 300);
    const fetch = createRequestQueue(network.fetch, clock);

    await Promise.all([
      fetch("https://securetoken.googleapis.com/a"),
      fetch("https://riders.rouvy.com/b"),
      fetch("https://activities.virtualtraining.eu/c"),
    ]);

    expect(network.maxInFlight()).toBe(1);
    expect(network.log.map((l) => new URL(l.url).pathname)).toEqual(["/a", "/b", "/c"]);
  });

  it("starts each request at least 1 s after the previous one ends", async () => {
    const clock = fakeClock();
    const network = slowNetwork(clock, 300);
    const fetch = createRequestQueue(network.fetch, clock);

    await Promise.all([fetch("https://x.test/1"), fetch("https://x.test/2"), fetch("https://x.test/3")]);
    clock.advance(5_000);
    await fetch("https://x.test/4");

    const [first, second, third, fourth] = network.log;
    expect(second!.start - first!.end).toBeGreaterThanOrEqual(1_000);
    expect(third!.start - second!.end).toBeGreaterThanOrEqual(1_000);
    // Long idle: no extra wait.
    expect(fourth!.start - third!.end).toBe(5_000);
  });

  it("does not wait before the very first request", async () => {
    const clock = fakeClock();
    const startedAt = clock.now();
    const network = slowNetwork(clock, 0);

    await createRequestQueue(network.fetch, clock)("https://x.test/1");

    expect(network.log[0]!.start).toBe(startedAt);
  });

  it("keeps the spacing and the queue going after a failed request", async () => {
    const clock = fakeClock();
    const network = slowNetwork(clock, 100, (url) => url.endsWith("/1"));
    const fetch = createRequestQueue(network.fetch, clock);

    const results = await Promise.allSettled([fetch("https://x.test/1"), fetch("https://x.test/2")]);

    expect(results.map((r) => r.status)).toEqual(["rejected", "fulfilled"]);
    expect(network.log[1]!.start - network.log[0]!.end).toBeGreaterThanOrEqual(1_000);
  });
});
