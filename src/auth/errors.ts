/** A failed login, refresh or Session call, with a message safe to show the rider. Never carries a response body. */
export class AuthError extends Error {
  override name = "AuthError";
}
