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
  operator,
  handle,
  headers,
  email = "",
  problem,
}: {
  details: ConsentDescription;
  /** Who runs this instance: the rider is about to hand them their Rouvy login. */
  operator: Operator;
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
<p>Unofficial, not affiliated with Rouvy. Run by ${escape(operator.name)}.</p>
${notice}
<form method="post">
  <input type="hidden" name="handle" value="${escape(handle)}">
  <label for="email">Rouvy email</label>
  <input id="email" name="email" type="email" autocomplete="username" required value="${escape(email)}">
  <label for="password">Rouvy password</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required>
  <label class="consent"><input name="accept_risk" type="checkbox" required>
    <span>I'm connecting my own Rouvy account at my own risk. Rouvy's terms (§7.c, §14.a.vi) may not allow access like this, and Rouvy could restrict or close my account. I accept the Hard stop: if Rouvy objects to or blocks this instance, it shuts down and deletes every connection within 24 hours.</span></label>
  <label class="consent"><input name="consent_health" type="checkbox" required>
    <span>I give my explicit consent (GDPR Art. 9(2)(a)) to this instance processing my ride data, which includes health data such as heart rate, only to answer my MCP client, as the privacy notice describes.</span></label>
  <button type="submit" name="action" value="connect">Connect</button>
  <button type="submit" name="action" value="cancel" formnovalidate>Cancel</button>
</form>
<p><a href="/privacy">Privacy notice</a> · <a href="${SELF_HOST_URL}">Host your own</a></p>`,
    { headers },
  );
}

/** Who runs this instance, as the privacy notice names them. */
export interface Operator {
  name: string;
  contact: string;
}

/** The Art. 13 notice (spec-m2 §10). Drafted, not legal advice: the operator owns the wording. */
export function privacyPage(operator: Operator): Response {
  const name = escape(operator.name);
  const contact = `<a href="mailto:${escape(operator.contact)}">${escape(operator.contact)}</a>`;
  return page(
    "Privacy notice",
    `<h1>Privacy notice</h1>
<h2>1. Who is responsible</h2>
<p>This instance of rouvy-mcp is run by ${name}, the controller of your personal data. Write to ${contact} for anything about your data.</p>
<p>rouvy-mcp is unofficial and not affiliated with Rouvy. This instance is free and invite-only.</p>
<h2>2. Person in charge under Québec's Law 25</h2>
<p>The operator is established in Québec. ${name} is the person in charge of the protection of personal information, reachable at the same address.</p>
<h2>3. What it's for</h2>
<p>One purpose only: reading your own Rouvy rides so that the MCP client you connected (claude.ai, for example) can answer your questions about them. To do that, the instance handles:</p>
<ul>
  <li><strong>your Rouvy email and password</strong>, once, when you sign in. The password goes to Rouvy's sign-in service (Google Firebase) and is then discarded, never stored or logged;</li>
  <li><strong>your Rouvy refresh token and email</strong>, kept encrypted with each connection (Grant), and your Rouvy account id, which labels it, so the instance can sign in to Rouvy for you while it answers your client;</li>
  <li><strong>your ride data</strong>, read from Rouvy when your client asks: Activities with their power, cadence, speed and heart rate, and the rider settings Rouvy keeps with them (weight, FTP, zones). Heart rate, and arguably weight, are health data. It is only passed on to your client.</li>
</ul>
<h2>4. Legal basis</h2>
<p>Your consent, GDPR Art. 6(1)(a), and for heart rate and other health data your explicit consent, Art. 9(2)(a). You give both with the two boxes on the sign-in page, every time you connect. You can withdraw them at any time by disconnecting (section 8); that doesn't affect what was done before.</p>
<h2>5. Who receives your data</h2>
<ul>
  <li><strong>Cloudflare</strong>, which hosts the instance, as processor under its data processing agreement.</li>
  <li><strong>Rouvy</strong> is the source: the instance signs in to your Rouvy account and reads from it, read-only. Rouvy sees these requests coming from this instance.</li>
  <li><strong>Your MCP client</strong> receives your ride data because you asked it to; what it does with it is between you and its provider.</li>
</ul>
<p>Nothing is sold or shared with anyone else.</p>
<h2>6. Where it's kept</h2>
<p>The part of the instance that reads your rides from Rouvy and holds them in memory runs in the European Union (a Cloudflare Durable Object in the EU jurisdiction). The sign-in page, and the front that checks your client's tokens, run at whichever Cloudflare location is nearest you. Connections are stored in Cloudflare's global key-value store, with your refresh token and email encrypted by a key that only your client's tokens unlock. The operator, in Québec, can delete them but cannot read your token from storage.</p>
<h2>7. How long it's kept</h2>
<ul>
  <li><strong>Connections (Grants)</strong>, with your encrypted refresh token and email, and your account id: deleted after 30 days without use.</li>
  <li><strong>Logs</strong>: kept 7 days. They hold tool names, outcomes, durations and status codes, and the sign-in library's error lines, which name apps, not riders. Never your email, account id, IP address or tokens.</li>
  <li><strong>Ride data and your Rouvy session</strong>: in memory only, dropped after 30 minutes idle. No ride data is stored.</li>
</ul>
<h2>8. Your rights, and how to disconnect</h2>
<p>You have the right to access, correct and erase your data, to restrict or object to its processing, and to data portability. Withdrawing consent means disconnecting, in any of three ways:</p>
<ul>
  <li><strong>remove the connector</strong> in your client: immediate if the client revokes its access, otherwise the connection is deleted after 30 days without use;</li>
  <li><strong>change your Rouvy password</strong>, which stops every connection working within the hour; each is deleted the next time your client uses it, or after 30 days;</li>
  <li><strong>write to</strong> ${contact}: the operator removes you from the invite list and erases every connection of yours.</li>
</ul>
<h2>9. Complaints</h2>
<p>Write to ${contact} first if you like. You can also complain to the data protection authority where you live or work (in the EU or UK), or to Québec's Commission d'accès à l'information (CAI).</p>
<h2>10. No automated decisions</h2>
<p>The instance makes no automated decisions about you and does no profiling.</p>
<h2>11. If Rouvy objects: the Hard stop</h2>
<p>If Rouvy objects to this instance or blocks it, the instance shuts down and every connection is deleted within 24 hours. The operator emails invited riders when that happens.</p>
<h2>12. EU Data Act</h2>
<p>Whatever its status under the EU Data Act, this instance keeps to the duties of its Art. 6: your ride data is used only for what you asked, never for profiling, sold or shared, not kept beyond the request, and your consent is never steered.</p>`,
  );
}

export function errorPage(message: string): Response {
  return page("Can't sign in", `<h1>Can't sign in</h1>\n<p>${escape(message)}</p>`, { status: 400 });
}
