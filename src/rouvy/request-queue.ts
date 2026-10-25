import type { Clock } from "./clock.js";

/** Minimum gap between the end of one request and the start of the next (spec §7). */
const SPACING_MS = 1_000;

/**
 * Wraps `fetch` so this process sends one request at a time, to every host, each starting at
 * least 1 s after the previous one ended. A request ends when its body has been read, so the
 * body is buffered here before the response is handed back.
 */
export function createRequestQueue(fetch: typeof globalThis.fetch, clock: Clock): typeof globalThis.fetch {
  let tail: Promise<unknown> = Promise.resolve();
  let lastEnd: number | undefined;

  return (input, init) => {
    const run = async () => {
      if (lastEnd !== undefined) await clock.sleep(lastEnd + SPACING_MS - clock.now());
      try {
        const response = await fetch(input, init);
        if (response.type === "opaqueredirect") return response;
        const body = await response.arrayBuffer();
        return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      } finally {
        lastEnd = clock.now();
      }
    };
    const result = tail.then(run, run);
    tail = result.catch(() => {});
    return result;
  };
}
