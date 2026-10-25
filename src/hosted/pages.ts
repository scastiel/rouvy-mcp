import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";

export const SELF_HOST_URL = "https://github.com/scastiel/rouvy-mcp#self-host-on-cloudflare";

/** Everything a client registered (its name, its domain) is the attacker's choice: escape it. */
function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function page(title: string, body: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 28rem; margin: 3rem auto; padding: 0 1rem; }
  label { display: block; margin: 1rem 0 0.25rem; }
  input { width: 100%; box-sizing: border-box; padding: 0.5rem; font: inherit; }
  .consent { display: flex; gap: 0.5rem; align-items: flex-start; }
  .consent input { width: auto; margin-top: 0.3rem; }
  button { margin: 1.5rem 0.5rem 0 0; padding: 0.5rem 1.25rem; font: inherit; }
  .message { padding: 0.75rem; border: 1px solid #c33; border-radius: 4px; }
</style>
${body}
</html>`;
  return new Response(html, { ...init, headers });
}

/** Why the sign-in didn't go through, shown above a fresh form. */
export interface Problem {
  message: string;
  /** Not on the allow-list: the page points to self-hosting. */
  inviteOnly?: boolean;
}

export function signInPage({
  details,
  handle,
  headers,
  email = "",
  problem,
}: {
  details: ConsentDescription;
  handle: string;
  /** From `beginConsent`: they bind the form to this browser and forbid framing. */
  headers: Headers;
  email?: string;
  problem?: Problem;
}): Response {
  const client = details.clientDomain
    ? `${escape(details.clientName)} (${escape(details.clientDomain)})`
    : escape(details.clientName);
  const notice = problem
    ? `<p class="message" role="alert">${escape(problem.message)}${
        problem.inviteOnly ? ` You can <a href="${SELF_HOST_URL}">host your own</a>.` : ""
      }</p>`
    : "";
  return page(
    "Sign in to Rouvy",
    `<h1>${client} wants to read your Rouvy rides</h1>
<p>Access will be sent to <strong>${escape(details.redirectHost)}</strong>.</p>
<p>Unofficial, not affiliated with Rouvy.</p>
${notice}
<form method="post">
  <input type="hidden" name="handle" value="${escape(handle)}">
  <label for="email">Rouvy email</label>
  <input id="email" name="email" type="email" autocomplete="username" required value="${escape(email)}">
  <label for="password">Rouvy password</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required>
  <label class="consent"><input name="accept_risk" type="checkbox" required>
    <span>I understand that Rouvy's terms (§7.c, §14.a.vi) may not allow this, and that Rouvy could restrict or close my own Rouvy account. If Rouvy objects to or blocks this instance, it shuts down and deletes every connection within 24 hours.</span></label>
  <label class="consent"><input name="consent_health" type="checkbox" required>
    <span>I explicitly consent to this instance processing my ride data, which includes health data such as heart rate (GDPR Art. 9(2)(a)).</span></label>
  <button type="submit" name="action" value="connect">Connect</button>
  <button type="submit" name="action" value="cancel" formnovalidate>Cancel</button>
</form>
<p><a href="/privacy">Privacy notice</a> · <a href="${SELF_HOST_URL}">Host your own</a></p>`,
    { headers },
  );
}

/** A stub until the legal-pages ticket lands the real notice (spec-m2 §10). */
export function privacyPage(): Response {
  return page(
    "Privacy",
    `<h1>Privacy</h1>
<p>This unofficial instance reads your Rouvy rides only while answering your MCP client. Each connection stores, encrypted, your Rouvy refresh token, account id and email.</p>
<p>The full privacy notice is coming soon.</p>`,
  );
}

export function errorPage(message: string): Response {
  return page("Can't sign in", `<h1>Can't sign in</h1>\n<p>${escape(message)}</p>`, { status: 400 });
}
