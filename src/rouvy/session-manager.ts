import { AuthError } from "../auth/errors.js";
import { renewSession, type Session } from "../auth/session.js";
import type { CredentialsProvider } from "../credentials/types.js";
import type { Clock } from "./clock.js";
import { notLoggedIn } from "./errors.js";

/** Renew this long before the idToken's `exp`, so a request never goes out with a dying token. */
const RENEW_MARGIN_MS = 5 * 60_000;

/** A live Session, plus the cookies riders.rouvy.com sets along the way. In memory only. */
export interface RiderSession {
  uid: string;
  cookieHeader(): string;
  keepCookies(setCookieHeaders: string[]): void;
}

export interface SessionManager {
  /** The current Session, renewed first when missing, near expiry, or for another account. */
  current(): Promise<RiderSession>;
  /** Whose Credentials are stored right now, without touching the network. */
  uid(): Promise<string>;
  /** Forgets the Session, so the next `current()` renews it. */
  invalidate(): void;
}

export function createSessionManager(
  fetch: typeof globalThis.fetch,
  credentials: CredentialsProvider,
  clock: Clock,
): SessionManager {
  let session: (RiderSession & { expiresAt: number }) | undefined;

  // Re-read every time, so a new `login` (even as someone else) applies without a restart.
  async function loadCredentials() {
    const stored = await credentials.load();
    if (!stored) throw notLoggedIn();
    return stored;
  }

  return {
    async current() {
      const stored = await loadCredentials();
      if (!session || session.uid !== stored.uid || clock.now() >= session.expiresAt - RENEW_MARGIN_MS) {
        try {
          const renewed = await renewSession(fetch, credentials, stored);
          session = { ...riderSession(renewed), expiresAt: jwtExpiry(renewed.idToken) ?? clock.now() };
        } catch (error) {
          session = undefined;
          if (error instanceof AuthError) throw notLoggedIn();
          throw error;
        }
      }
      return session;
    },
    async uid() {
      return (await loadCredentials()).uid;
    },
    invalidate() {
      session = undefined;
    },
  };
}

function riderSession({ uid, cookie }: Session): RiderSession {
  const jar = new Map([["rouvy_session", cookie]]);
  return {
    uid,
    cookieHeader: () => [...jar].map(([name, value]) => `${name}=${value}`).join("; "),
    keepCookies(setCookieHeaders) {
      for (const header of setCookieHeaders) {
        const match = /^([^=;\s]+)=([^;]*)/.exec(header);
        if (match?.[1]) jar.set(match[1], match[2] ?? "");
      }
    },
  };
}

/** Milliseconds since the epoch at which the JWT expires, if it says. Only reads, never verifies. */
function jwtExpiry(jwt: string): number | undefined {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}
