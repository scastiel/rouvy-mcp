import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";

const SELF_HOST_URL = "https://github.com/scastiel/rouvy-mcp#self-host-on-cloudflare";

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
  button { margin-top: 1.5rem; padding: 0.5rem 1.25rem; font: inherit; }
  .message { padding: 0.75rem; border: 1px solid #c33; border-radius: 4px; }
</style>
${body}
</html>`;
  return new Response(html, { ...init, headers });
}

export function signInPage({
  details,
  handle,
  headers,
  email = "",
  message,
}: {
  details: ConsentDescription;
  handle: string;
  /** From `beginConsent`: they bind the form to this browser and forbid framing. */
  headers: Headers;
  email?: string;
  message?: string;
}): Response {
  const client = details.clientDomain
    ? `${escape(details.clientName)} (${escape(details.clientDomain)})`
    : escape(details.clientName);
  const notice = message
    ? `<p class="message" role="alert">${escape(message)}${
        message.includes("invite-only") ? ` You can <a href="${SELF_HOST_URL}">host your own</a>.` : ""
      }</p>`
    : "";
  return page(
    "Sign in to Rouvy",
    `<h1>${client} wants to read your Rouvy rides</h1>
<p>Access will be sent to <strong>${escape(details.redirectHost)}</strong>.</p>
${notice}
<form method="post">
  <input type="hidden" name="handle" value="${escape(handle)}">
  <label for="email">Rouvy email</label>
  <input id="email" name="email" type="email" autocomplete="username" required value="${escape(email)}">
  <label for="password">Rouvy password</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required>
  <button type="submit">Connect</button>
</form>`,
    { headers },
  );
}

export function errorPage(message: string): Response {
  return page("Can't sign in", `<h1>Can't sign in</h1>\n<p>${escape(message)}</p>`, { status: 400 });
}
