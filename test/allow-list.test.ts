import { describe, expect, it } from "vitest";
import { ALLOWED_WRITES } from "../src/rouvy/allow-list.js";
import { createPoliteFetch } from "../src/server.js";
import { fakeClock, json } from "./server-harness.js";

/** A network that answers anything, and remembers what reached it. */
function openNetwork() {
  const sent: string[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    sent.push(`${request.method} ${request.url}`);
    return json({});
  }) as typeof globalThis.fetch;
  return { politeFetch: createPoliteFetch(fetch, fakeClock()), sent };
}

describe("the write allow-list", () => {
  it("is exactly the three Workout write routes and the login, refresh and Session posts", () => {
    expect(ALLOWED_WRITES.map(({ method, host, path }) => `${method} ${host} ${path.source}`)).toEqual([
      "POST riders.rouvy.com ^\\/workouts\\/create$",
      "POST riders.rouvy.com ^\\/workouts\\/\\d+\\/edit$",
      "POST riders.rouvy.com ^\\/workouts\\/\\d+\\.data$",
      "POST identitytoolkit.googleapis.com ^\\/v1\\/accounts:signInWithPassword$",
      "POST securetoken.googleapis.com ^\\/v1\\/token$",
      "POST account.rouvy.com ^\\/resources\\/auth\\.data$",
    ]);
  });

  it("lets every allowed write and any GET through the polite fetch", async () => {
    const { politeFetch, sent } = openNetwork();
    const allowed = [
      "https://riders.rouvy.com/workouts/create",
      "https://riders.rouvy.com/workouts/123456/edit",
      "https://riders.rouvy.com/workouts/123456.data",
      "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=k",
      "https://securetoken.googleapis.com/v1/token?key=k",
      "https://account.rouvy.com/resources/auth.data",
    ];

    for (const url of allowed) await politeFetch(url, { method: "POST" });
    await politeFetch("https://riders.rouvy.com/activity/260503195435-fixture0.data");

    expect(sent).toHaveLength(allowed.length + 1);
  });

  it.each([
    ["POST", "https://riders.rouvy.com/activity/260503195435-fixture0.data"],
    ["POST", "https://riders.rouvy.com/workouts/abc/edit"],
    ["POST", "https://riders.rouvy.com/workouts/1/edit/x"],
    ["POST", "https://riders.rouvy.com/workouts/1"],
    ["POST", "https://riders.rouvy.com/resources/workout-upload.data"],
    ["POST", "https://riders.rouvy.com/settings"],
    ["POST", "http://riders.rouvy.com/workouts/create"],
    ["POST", "https://riders.rouvy.com.example.com/workouts/create"],
    ["POST", "https://account.rouvy.com/resources/other.data"],
    ["PUT", "https://riders.rouvy.com/workouts/1/edit"],
    ["PATCH", "https://riders.rouvy.com/workouts/1.data"],
    ["DELETE", "https://riders.rouvy.com/workouts/1.data"],
  ])("refuses %s %s before sending anything", async (method, url) => {
    const { politeFetch, sent } = openNetwork();

    await expect(politeFetch(url, { method })).rejects.toThrow(/rouvy-mcp refuses to send/);
    await expect(politeFetch(new Request(url, { method }))).rejects.toThrow(/rouvy-mcp refuses to send/);

    expect(sent).toEqual([]);
  });

  it("never names the query string of a refused request", async () => {
    const { politeFetch } = openNetwork();

    await expect(politeFetch("https://riders.rouvy.com/x?token=secret", { method: "POST" })).rejects.toThrow(
      "rouvy-mcp refuses to send POST https://riders.rouvy.com/x",
    );
  });
});
