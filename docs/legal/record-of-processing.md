# Record of processing activities (GDPR Art. 30)

For the **Public instance** of rouvy-mcp ([spec-m2 §10](../spec-m2.md#10-legal-gdpr-and-rouvy)). Drafted, not legal advice: the maintainer reviews and owns it. A self-hoster is the controller of their own instance and keeps their own record; this one can serve as a template.

**Last reviewed:** _(date of the maintainer's review)_

## Controller

- **Controller:** the maintainer, as named in `OPERATOR_NAME` in [`wrangler.toml`](../../wrangler.toml), established in Québec, Canada.
- **Contact:** the address in `OPERATOR_CONTACT`. It is also on [`/privacy`](https://rides-mcp.scastiel.workers.dev/privacy).
- **Person in charge of the protection of personal information (Québec, Law 25):** the maintainer.
- **Representative in the EU / UK (Art. 27):** none appointed; see [Art. 27(2) exemption](#art-272-exemption).
- **Data protection officer:** none; not required (Art. 37: no large-scale or systematic monitoring).

## The processing

One processing activity: **reading a rider's own Rouvy rides for the MCP client they connected.**

| | |
|---|---|
| **Purpose** | Let an invited rider's MCP client (claude.ai, for example) read that rider's own Rouvy Activities, read-only, on their request. |
| **Legal basis** | Consent, Art. 6(1)(a). For health data, explicit consent, Art. 9(2)(a). Both are given with the two sign-in checkboxes, on every sign-in, and withdrawn by disconnecting. |
| **Data subjects** | Invited riders: adults with a Rouvy account, on the allow-list. |
| **Categories of data** | Rouvy email and password (the password at sign-in only, never stored); Rouvy refresh token, Firebase uid, email (stored, encrypted, in each Grant); ride data (Activities, power, cadence, speed, heart rate, Rider settings such as weight, FTP and zones), in memory only. |
| **Special categories** | Health data (Art. 9): heart rate, and arguably weight and heart-rate zones within Rider settings. |
| **Recipients** | Cloudflare, Inc., as processor (hosting: Workers, Durable Objects, KV, Workers Logs), under its DPA. The rider's own MCP client, at the rider's request. Rouvy and its sign-in service (Google Firebase) are the source the instance signs in to, not recipients of anything new. |
| **Transfers** | Cloudflare's network is global. The Durable Object that handles ride data runs in the EU jurisdiction. KV, which holds the encrypted Grants, is global. The controller is in Québec. Canada's EU adequacy decision covers only organisations under PIPEDA, which this non-commercial instance is not, so it gives no cover here; the controller can delete Grants but cannot decrypt the refresh tokens in them. Cloudflare's transfers are covered by its DPA (standard contractual clauses, EU–US Data Privacy Framework). |
| **Retention** | Grants (encrypted refresh token, uid, email): deleted after **30 days** without use. Access tokens: 1 hour. Workers Logs: **7 days**, our own structured events only, with no uid, email, IP address, token or `props`. Ride data, cookies and the Rouvy Session: in memory, dropped after **30 minutes** idle. **No Activity data at rest.** |
| **Security measures** | See [Security measures](#security-measures). |
| **Automated decisions** | None. No profiling. |

## Security measures

- **Token custody** ([spec-m2 §6](../spec-m2.md#6-token-custody-and-sessions)): the Rouvy refresh token lives only in the Grant's `props`, which the OAuth provider encrypts with a per-Grant key wrapped by each of that Grant's tokens. There is no server-side key: a KV dump alone reveals nothing, and the server can only use a rider's token while serving one of that rider's requests.
- **The password** is sent once to Firebase over TLS, then discarded: never stored, never logged.
- **Allow-list** checked on the typed email before any Firebase call, and again on the email Firebase returns.
- **Logging** ([spec-m2 §9](../spec-m2.md#9-operations)): invocation logs off; only our own structured events, with no personal data.
- **Read-only by construction:** the code makes no write to Rouvy.
- **Kill paths:** per rider (remove from the allow-list, delete their Grants: [operations.md](../operations.md#kill-one-rider)); for everyone, the [Hard stop](../runbooks/hard-stop.md) and the [token-leak runbook](../runbooks/token-leak.md).
- **Breach log** (Art. 33(5)), which is also the Law 25 confidentiality-incident register: kept privately by the maintainer.

## Art. 27(2) exemption

GDPR applies through Art. 3(2)(a): the instance offers a service to riders in the EU (and, through the UK GDPR, the UK) from outside it. Art. 27(1) would then require a representative in the EU, unless Art. 27(2)(a) applies: processing that is **occasional**, does **not include, on a large scale**, special categories of data, and is **unlikely to result in a risk** to rights and freedoms.

We rely on that exemption because:

- **Not large scale:** the instance is invite-only, with a handful of riders the maintainer knows, and no plan to grow beyond the allow-list without Rouvy's written permission ([spec-m2 §1](../spec-m2.md#1-scope)).
- **Low risk:** no ride data is stored; the one thing kept is an encrypted refresh token the operator cannot read; access is read-only; the rider can end it any time by changing their Rouvy password; the [DPIA](dpia.md) finds the residual risk low.
- **Occasional:** each rider's data is processed only when their own client calls, on their request.

**Known weakness:** a service that runs all the time could be read as "regular", not occasional, which would take the exemption away.

**Revisit trigger:** appoint a representative (in the EU, and in the UK for UK riders) as soon as either:

- the instance grows beyond the invite-only allow-list, or the allow-list grows beyond a small circle; or
- any data protection authority asks.

Record the representative here when one is appointed.

## Other regimes

- **Québec, Law 25:** the maintainer is the person in charge; the [DPIA](dpia.md) doubles as the s. 17 assessment for information leaving Québec; the breach log doubles as the incident register.
- **PIPEDA:** not applicable: the instance is free and non-commercial.
- **EU Data Act:** whether a free operator is a "data recipient" (Art. 2(14)) is open; the instance keeps to Art. 6's duties anyway, as `/privacy` says.
