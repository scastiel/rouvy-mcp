# Runbook: Hard stop

Shutting the Public instance down for good, within 24 h, by the maintainer alone ([spec-m2 §9](../spec-m2.md#9-operations)). Stdio and self-host are unaffected.

## When: block or drift

The daily canary ([`canary.yml`](../../.github/workflows/canary.yml)) runs M1's account-free checks from GitHub, and asks the Public instance's `GET /health`, which runs the same checks from the Worker's own egress and reports the Durable Object's hard block signals over the last 24 h. Its issue says which side failed.

**It's a block, so Hard stop,** when either:

- the Worker-side checks fail while the GitHub-side checks pass, or
- the Durable Object's hard block signals persist for over 1 h (`/health` reports `"persisting": true`). Those signals are a Cloudflare 403 or challenge, or Rouvy refusing `auth.data` despite a fresh idToken. In Workers Logs, they're the `block_signal` events.

**Any objection from Rouvy,** through any channel: Hard stop.

**Both sides fail: it's Rouvy drift.** Fix it as in M1. The instance stays up, with tools returning errors meanwhile.

**Not a block:** 429s and short cool-downs (`cool_down` events with `"reason": "rate_limited"`) are normal politeness. Firebase or Rouvy outages need no runbook either: transient tool errors, and no retries beyond M1's.

## Steps

1. Turn the sign-in page into a "closed" notice (one redeploy) and add a line to the README.
2. Email the invited riders. The maintainer keeps a private copy of the invite list outside the Worker for this.
3. Delete the KV namespace, which removes every Grant and token.
4. Delete the Worker and its Durable Object.
5. If Rouvy objected, reply to them confirming it's done.
