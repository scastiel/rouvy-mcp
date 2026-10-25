import type { Credentials, CredentialsProvider } from "../credentials/types.js";
import { refreshIdToken } from "./firebase.js";
import { openRouvySession } from "./rouvy-session.js";

export interface Session {
  uid: string;
  idToken: string;
  /** The `rouvy_session` cookie value. In memory only. */
  cookie: string;
}

/**
 * Opens a fresh Session from stored Credentials, without the password:
 * securetoken refresh, then `auth.data`. Saves the refresh token if Firebase rotated it.
 */
export async function renewSession(
  fetch: typeof globalThis.fetch,
  credentials: CredentialsProvider,
  stored: Credentials,
): Promise<Session> {
  const tokens = await refreshIdToken(fetch, stored.refreshToken);
  if (tokens.refreshToken !== stored.refreshToken) {
    await credentials.save({ ...stored, refreshToken: tokens.refreshToken });
  }
  const cookie = await openRouvySession(fetch, tokens);
  return { uid: tokens.uid, idToken: tokens.idToken, cookie };
}
