import { describe, expect, it } from "vitest";
import { createRider } from "../src/server.js";
import { firebaseError } from "./fakes.js";
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

/** The hosted server builds one server per HTTP request around one Rider per uid. */
describe("servers built around one Rider", () => {
  it("share its Session and caches", async () => {
    const clock = fakeClock();
    const network = fakeNetwork({
      [REFRESH]: refreshes(clock),
      [AUTH_DATA]: rouvySessionOpened,
      [LIST]: () => listPage([activityRow("a00")]),
    });
    const credentials = memoryCredentials({ refreshToken: "refresh-for-uid-1", uid: "uid-1" });
    const rider = createRider({ credentials: credentials.provider, fetch: network.fetch, clock });

    for (let i = 0; i < 2; i++) {
      const client = await connect({ rider });
      const result = await client.callTool({ name: "list_activities", arguments: { limit: 1 } });
      expect(text(result)).toContain("a00");
    }

    // One renewal (refresh + auth.data) and one list page, for both requests.
    expect(network.requests).toHaveLength(3);
  });

  it("say what the caller wants when the rider isn't signed in, not the stdio login command", async () => {
    const clock = fakeClock();
    const network = fakeNetwork({ [REFRESH]: () => firebaseError("TOKEN_EXPIRED") });
    const credentials = memoryCredentials({ refreshToken: "refresh-for-uid-1", uid: "uid-1" });
    const client = await connect({
      credentials: credentials.provider,
      fetch: network.fetch,
      clock,
      notLoggedInMessage: () => "Reconnect in your MCP client.",
    });

    const result = await client.callTool({ name: "list_activities", arguments: {} });

    expect(result.isError).toBe(true);
    expect(text(result)).toBe("Reconnect in your MCP client.");
  });
});
