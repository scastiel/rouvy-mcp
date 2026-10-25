import {
  AuthorizationError,
  CimdFetchError,
  type AuthRequest,
  type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import { AuthError } from "../auth/errors.js";
import { signInWithPassword } from "../auth/firebase.js";
import { openRouvySession } from "../auth/rouvy-session.js";
import { errorPage, signInPage, type Problem } from "./pages.js";
import type { GrantProps } from "./riders.js";

export interface AuthorizeOptions {
  oauth: OAuthHelpers;
  /** The `ALLOW_LIST` secret: emails separated by commas or whitespace. */
  allowList: string | undefined;
  /** Already carries the honest user agent. */
  fetch: typeof globalThis.fetch;
}

const INVITE_ONLY: Problem = { message: "This instance is invite-only.", inviteOnly: true };

/**
 * The sign-in page (spec-m2 §5): Rouvy email and password, checked against the allow-list before
 * Firebase ever sees them, then M1's sign-in and one Rouvy check. The password is used once and
 * dropped; the Grant keeps only the refresh token, encrypted by the provider.
 */
export async function authorize(request: Request, { oauth, allowList, fetch }: AuthorizeOptions): Promise<Response> {
  const allowed = parseAllowList(allowList);
  try {
    if (request.method === "GET") return await showSignIn(oauth, await oauth.parseAuthRequest(request));
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "GET, POST" } });

    const form = await request.formData();
    // Checks this browser opened the page, and works once: a stranger can't post here directly.
    const approved = await oauth.approveConsent(request, String(form.get("handle") ?? ""));
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const retry = async (problem: Problem) => {
      const response = await showSignIn(oauth, approved.request, { email, problem });
      for (const cookie of approved.headers.getSetCookie()) response.headers.append("set-cookie", cookie);
      return response;
    };

    // Before any Firebase call, so this page can't test passwords against Firebase from our egress.
    if (!allowed.has(email.toLowerCase())) return await retry(INVITE_ONLY);

    let props: GrantProps;
    try {
      const tokens = await signInWithPassword(fetch, email, password);
      if (!tokens.email || !allowed.has(tokens.email.toLowerCase())) return await retry(INVITE_ONLY);
      // Once, to confirm the account works on Rouvy, not just on Firebase.
      await openRouvySession(fetch, tokens);
      props = { refreshToken: tokens.refreshToken, uid: tokens.uid, email: tokens.email };
    } catch (error) {
      return await retry({ message: error instanceof AuthError ? error.message : "Couldn't reach Rouvy. Try again later." });
    }

    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId: props.uid,
      metadata: {},
      scope: [],
      props,
    });
    approved.headers.set("location", redirectTo);
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (error) {
    // Only a validated client and redirect URI may be redirected to; anything else is shown here.
    if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
    if (error instanceof AuthorizationError) return errorPage(error.description);
    if (error instanceof CimdFetchError) return errorPage("This app could not be verified.");
    throw error;
  }
}

async function showSignIn(oauth: OAuthHelpers, authRequest: AuthRequest, form?: { email: string; problem: Problem }) {
  const details = await oauth.describeConsent(authRequest); // first: a failed lookup leaves nothing in KV
  const consent = await oauth.beginConsent(authRequest);
  return signInPage({ details, handle: consent.handle, headers: consent.headers, ...form });
}

function parseAllowList(secret = ""): Set<string> {
  return new Set(
    secret
      .split(/[\s,]+/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}
