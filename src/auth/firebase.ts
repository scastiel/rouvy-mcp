import { ROUVY_FIREBASE_WEB_KEY } from "../constants.js";
import { AuthError } from "./errors.js";

export interface FirebaseTokens {
  idToken: string;
  refreshToken: string;
  uid: string;
}

export async function signInWithPassword(fetch: typeof globalThis.fetch, email: string, password: string): Promise<FirebaseTokens> {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${ROUVY_FIREBASE_WEB_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const body = (await readJson(response)) as { idToken?: string; refreshToken?: string; localId?: string };
  if (!response.ok) throw new AuthError(describeFirebaseError(body));
  if (!body.idToken || !body.refreshToken || !body.localId) throw new AuthError("Login failed: unexpected answer from Firebase.");
  return { idToken: body.idToken, refreshToken: body.refreshToken, uid: body.localId };
}

/** Trades a refresh token for a fresh idToken. Firebase may rotate the refresh token too. */
export async function refreshIdToken(fetch: typeof globalThis.fetch, refreshToken: string): Promise<FirebaseTokens> {
  const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${ROUVY_FIREBASE_WEB_KEY}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  const body = (await readJson(response)) as { id_token?: string; refresh_token?: string; user_id?: string };
  if (!response.ok) throw new AuthError(describeFirebaseError(body));
  if (!body.id_token || !body.user_id) throw new AuthError("Refresh failed: unexpected answer from Firebase.");
  return { idToken: body.id_token, refreshToken: body.refresh_token ?? refreshToken, uid: body.user_id };
}

const PLAIN_MESSAGES: Record<string, string> = {
  INVALID_LOGIN_CREDENTIALS: "Wrong email or password.",
  INVALID_PASSWORD: "Wrong email or password.",
  EMAIL_NOT_FOUND: "Wrong email or password.",
  INVALID_EMAIL: "That doesn't look like an email address.",
  TOO_MANY_ATTEMPTS_TRY_LATER: "Too many login attempts. Try again later.",
  USER_DISABLED: "This Rouvy account is disabled.",
  TOKEN_EXPIRED: "The login has expired.",
  INVALID_REFRESH_TOKEN: "The login has expired.",
  USER_NOT_FOUND: "The login has expired.",
};

/**
 * Firebase answers `{ error: { message: "CODE" } }`, sometimes `"CODE : details"`, and the details
 * can echo what was submitted. Only the bare code is ever looked at.
 */
function describeFirebaseError(body: unknown): string {
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
  const code = typeof message === "string" ? /^[A-Z_]+/.exec(message)?.[0] : undefined;
  return (code && PLAIN_MESSAGES[code]) ?? "Firebase refused the request.";
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
