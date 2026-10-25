import { describe, expect, it } from "vitest";
import { isTerminalAuthFailure } from "../src/rouvy/errors.js";
import { createSessionManager } from "../src/rouvy/session-manager.js";
import { createPoliteFetch } from "../src/server.js";
import { firebaseError } from "./fakes.js";
import { AUTH_DATA, fakeClock, fakeNetwork, memoryCredentials, REFRESH, refreshes, rouvySessionOpened } from "./server-harness.js";

type Handler = Parameters<typeof fakeNetwork>[0][string];

/** Why opening a Session failed, as the hosted server will ask: does this end the rider's login? */
async function renewalFailure(routes: { refresh?: Handler; authData?: Handler }) {
  const clock = fakeClock();
  const network = fakeNetwork({ [REFRESH]: routes.refresh ?? refreshes(clock), [AUTH_DATA]: routes.authData ?? rouvySessionOpened });
  const credentials = memoryCredentials({ refreshToken: "refresh-for-uid-1", uid: "uid-1" });
  const sessions = createSessionManager(createPoliteFetch(network.fetch, clock), credentials.provider, clock);
  return sessions.current().then(
    () => expect.fail("the Session opened"),
    (error: unknown) => error as Error,
  );
}

describe("a failed Session renewal", () => {
  it.each(["INVALID_REFRESH_TOKEN", "TOKEN_EXPIRED", "USER_NOT_FOUND", "USER_DISABLED"])(
    "is terminal when Firebase answers %s, with stdio's 'not logged in' message",
    async (code) => {
      const error = await renewalFailure({ refresh: () => firebaseError(code) });

      expect(isTerminalAuthFailure(error)).toBe(true);
      expect(error.message).toContain("Not logged in to Rouvy");
    },
  );

  it("is transient when Firebase says TOO_MANY_ATTEMPTS_TRY_LATER", async () => {
    const error = await renewalFailure({ refresh: () => firebaseError("TOO_MANY_ATTEMPTS_TRY_LATER") });

    expect(isTerminalAuthFailure(error)).toBe(false);
    expect(error.message).toContain("Not logged in to Rouvy");
  });

  it("is transient when Firebase answers a 5xx", async () => {
    const error = await renewalFailure({ refresh: () => new Response("oops", { status: 503 }) });

    expect(isTerminalAuthFailure(error)).toBe(false);
    expect(error.message).toBe("Rouvy is unavailable right now (HTTP 503). Try later.");
  });

  it("is transient when the network fails", async () => {
    const error = await renewalFailure({
      refresh: () => {
        throw new TypeError("fetch failed");
      },
    });

    expect(isTerminalAuthFailure(error)).toBe(false);
    expect(error.message).toBe("Rouvy is unavailable right now (it can't be reached). Try later.");
  });

  it("is transient when Rouvy refuses auth.data despite a fresh idToken", async () => {
    const error = await renewalFailure({ authData: () => new Response(null, { status: 202 }) });

    expect(isTerminalAuthFailure(error)).toBe(false);
    expect(error.message).toContain("Not logged in to Rouvy");
  });

  it("is transient when Firebase answers a code it doesn't know", async () => {
    const error = await renewalFailure({ refresh: () => firebaseError("SOMETHING_NEW") });

    expect(isTerminalAuthFailure(error)).toBe(false);
  });
});

describe("isTerminalAuthFailure", () => {
  it("is false for anything that isn't an auth failure", () => {
    expect(isTerminalAuthFailure(new Error("boom"))).toBe(false);
    expect(isTerminalAuthFailure(undefined)).toBe(false);
  });
});
