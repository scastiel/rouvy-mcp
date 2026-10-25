import { describe, expect, it } from "vitest";
import { createPoliteFetch } from "../src/server.js";
import {
  activityRow,
  AUTH_DATA,
  connect,
  fakeClock,
  fakeNetwork,
  LIST,
  listPage,
  memoryCredentials,
  REFRESH,
  refreshes,
  rouvySessionOpened,
  text,
} from "./server-harness.js";

/** Two riders, each with their own server, both behind one polite fetch (the hosted server's shape). */
async function twoRiders(list: () => Response | Promise<Response>) {
  const clock = fakeClock();
  const network = fakeNetwork({ [REFRESH]: refreshes(clock), [AUTH_DATA]: rouvySessionOpened, [LIST]: list });
  let inFlight = 0;
  let maxInFlight = 0;
  const slowFetch = (async (input, init) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return await network.fetch(input, init);
    } finally {
      inFlight--;
    }
  }) as typeof globalThis.fetch;
  const politeFetch = createPoliteFetch(slowFetch, clock);
  const riders = await Promise.all(
    ["uid-1", "uid-2"].map((uid) =>
      connect({ credentials: memoryCredentials({ refreshToken: `refresh-for-${uid}`, uid }).provider, politeFetch, clock }),
    ),
  );
  return { riders, network, maxInFlight: () => maxInFlight };
}

describe("servers sharing one polite fetch", () => {
  it("never have two Rouvy requests in flight", async () => {
    const { riders, network, maxInFlight } = await twoRiders(() => listPage([activityRow("a00")]));

    const results = await Promise.all(
      riders.map((client) => client.callTool({ name: "list_activities", arguments: { limit: 1 } })),
    );

    expect(results.map((r) => r.isError)).toEqual([undefined, undefined]);
    // Both riders renewed and listed: 3 requests each, one at a time.
    expect(network.requests).toHaveLength(6);
    expect(maxInFlight()).toBe(1);
  });

  it("share a cool-down: one rider's 429 holds back the other", async () => {
    const { riders, network } = await twoRiders(
      () => new Response("slow down", { status: 429, headers: { "retry-after": "120" } }),
    );
    const [first, second] = riders;

    const firstResult = await first!.callTool({ name: "list_activities", arguments: {} });
    const sent = network.requests.length;
    const secondResult = await second!.callTool({ name: "list_activities", arguments: {} });

    expect(text(firstResult)).toContain("Rouvy rate limited this server");
    expect(text(secondResult)).toContain("Rouvy rate limited this server");
    expect(network.requests).toHaveLength(sent);
  });
});
