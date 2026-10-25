/** A failed login, refresh or Session call, with a message safe to show the rider. Never carries a response body. */
export class AuthError extends Error {
  override name = "AuthError";

  /**
   * True when trying again can't help: Firebase refused the credentials themselves (spec-m2 §6).
   * Anything else (rate limits, unknown answers, Rouvy refusing a fresh idToken) is transient.
   */
  constructor(
    message: string,
    readonly terminal = false,
  ) {
    super(message);
  }
}
