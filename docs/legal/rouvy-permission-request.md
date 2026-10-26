# Rouvy permission request

The request for Rouvy's written permission ([spec-m2 §10](../spec-m2.md#10-legal-gdpr-and-rouvy), as changed by [spec-m3 §9](../spec-m3.md#9-hosted-server)). It is sent **when M3 is live on the Public instance**, by the maintainer, under their real name. The instance doesn't wait for an answer. Leaving the allow-list does: only a written yes counts, and silence is never a yes.

Drafted, not legal advice: the maintainer reviews it, signs it, and sends it.

## Checklist

**Before sending:** the Public instance runs M3.

- [ ] The stack is merged in order: #88 → #89 → #90 → #91 → #92 → this PR.
- [ ] `npm run contract:live -- --writes` passes on `main`, and `v0.3.0` is tagged and published ([releasing](../releasing.md)).
- [ ] Deploy the Public instance from `main`: `npm run deploy`. Then `curl -s https://rides-mcp.scastiel.workers.dev/health` answers `ok: true`, and `/authorize` shows the Workout wording.
- [ ] **End to end from claude.ai:**
  - [ ] The existing connector gets a 401 and asks you to reconnect. The sign-in page shows the new risk checkbox, unticked.
  - [ ] Reconnect, then ask, in turn: "list my Rouvy Workouts", "show me the first one", "create a 20-minute Workout called *rouvy-mcp e2e — delete me*: 5 min warm-up ramp from 50 to 75 %, 3 × (2 min at 105 %, 1 min free ride), 6 min at 60 %", "rename it to *rouvy-mcp e2e — delete me (edited)*", "delete it".
  - [ ] claude.ai asks before the update and the delete (`destructiveHint`).
  - [ ] "List my Rouvy Workouts" again: no *rouvy-mcp e2e* Workout is left. If one is, delete it in Rouvy's web app.
- [ ] Confirm the `CF-Worker` value Rouvy will see: in the Cloudflare dashboard, or by sending one request from the Worker to a request bin you control. Correct the email below if it isn't `scastiel.workers.dev`.

**Sending:**

- [ ] Open a ticket at Rouvy's help desk with the email below, asking for it to be forwarded to whoever owns partner or API access.
- [ ] Send the same text to one named Rouvy product or business person: _(name, role, how you reached them)_.
- [ ] Record below when it was sent, and the follow-up date, 4 weeks later.

| | |
|---|---|
| **Sent (help desk)** | _(date, ticket number)_ |
| **Sent (named person)** | _(date, name)_ |
| **Follow-up due** | _(sent date + 4 weeks)_ |
| **Follow-up sent** | _(date)_ |
| **Answer** | _(date, summary, link to where it's kept)_ |

**When the answer comes** ([spec-m2 §10](../spec-m2.md#10-legal-gdpr-and-rouvy) and [spec-m3 §9](../spec-m3.md#9-hosted-server)):

- **Yes:** the instance may leave the allow-list, as a fresh effort.
- **Yes with conditions:** a condition we can meet within the politeness charter becomes an operating rule. One we can't counts as a no for what it covers.
- **"Yes, but no writes":** a condition we can meet. A release removes the write tools from the Public instance and bumps `CONSENT_VERSION` again, with wording that drops writes, so every rider reconnects under it. Self-hosts and stdio keep writes.
- **No, an objection, or a block:** the [Hard stop](../runbooks/hard-stop.md), within 24 hours.
- **Silence:** invite-only indefinitely, still under the Hard stop.

## The email

**Subject:** Request for written permission (§29.i) for rouvy-mcp, an unofficial MCP server for Rouvy riders

Hello,

My name is Sebastien Castiel. I maintain **rouvy-mcp** (https://github.com/scastiel/rouvy-mcp), an open-source, unofficial MCP server that lets Rouvy riders use their own Rouvy data from AI assistants such as Claude. I'm writing to ask for Rouvy's written permission under §29.i of your terms for the hosted instance I run, and to make it easy for you to recognise and, if you prefer, stop it.

**What it does.** A rider connects their own Rouvy account and asks their assistant about their rides ("how did my last ride go?") or about their training plans. The instance then:

- reads the rider's own Activities and their per-second data;
- reads the rider's own Workouts, and **creates, edits and deletes the rider's own Workouts when the rider asks for it**, for example "make me a 4 × 4 min VO2 max Workout".

It does this through the same routes Rouvy's web app uses, signed in as that rider. It never writes anything other than Workouts the rider created themselves: no Activities, no settings, no profile, no catalogue or other riders' Workouts. Every other kind of write is refused in code before it leaves the instance. Each write is sent once, never retried, and only after the rider's request.

**How to recognise it:**

- Every request carries an honest user agent: `rouvy-mcp/<version> (+https://github.com/scastiel/rouvy-mcp)`.
- It runs on Cloudflare Workers from our own zone, so requests carry `CF-Worker: scastiel.workers.dev`. The instance is at https://rides-mcp.scastiel.workers.dev.
- It is polite by construction. There is one request at a time across the whole instance, with at least 1 second between requests, and nothing runs in the background. It backs off as soon as Rouvy answers 429 or a Cloudflare challenge, rather than retrying.
- It stores no Activity or Workout data. It keeps only each rider's refresh token, encrypted with a key that only that rider's client holds, and deletes it after 30 days of disuse.
- It is invite-only: a small allow-list of riders I know. It will stay that way unless Rouvy agrees otherwise.
- **The Hard stop:** if Rouvy objects or blocks it, the instance shuts down and every rider's connection is deleted within 24 hours. There will be no workaround: no rotating IPs, no disguised user agent, no new hosts.

**What I'm asking:**

1. Written permission under §29.i for this instance to keep operating as described, possibly with conditions. I'll treat any condition I can meet as an operating rule. If writing Workouts is a concern, I can remove the write tools from the hosted instance, so it only reads.
2. Optionally, if it's simpler for your team, allow-listing our zone so the instance is never mistaken for abusive traffic.

**On the EU Data Act.** Riders' ride data may fall under the Data Act's user access rights. I'd rather this happen in cooperation than by default: if Rouvy ever offers a sanctioned way for riders to share their data with a service of their choice, I'd gladly be among the first to use it, and to move this instance onto it.

The code is public, and I'm happy to answer any question, show you anything in it, or change how it behaves.

Thank you for reading,

Sebastien Castiel
sebastien@castiel.me
https://github.com/scastiel/rouvy-mcp
