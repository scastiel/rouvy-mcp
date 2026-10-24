import { AuthError } from "./errors.js";
import type { FirebaseTokens } from "./firebase.js";

/**
 * Trades Firebase tokens for a Rouvy Session, the way Rouvy's own sign-in page does.
 * Returns the `rouvy_session` cookie value, which only ever lives in memory.
 */
export async function openRouvySession(fetch: typeof globalThis.fetch, tokens: FirebaseTokens): Promise<string> {
  const response = await fetch("https://account.rouvy.com/resources/auth.data", {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      idToken: tokens.idToken,
      uid: tokens.uid,
      refreshToken: tokens.refreshToken,
      riders: "true",
      isNew: "false",
    }),
  });
  await response.body?.cancel();
  for (const cookie of response.headers.getSetCookie()) {
    const match = /^rouvy_session=([^;]+)/.exec(cookie);
    if (match?.[1]) return match[1];
  }
  throw new AuthError("Rouvy did not open a session for this account.");
}
