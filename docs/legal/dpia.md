# Data protection impact assessment

For the **Public instance** of rouvy-mcp ([spec-m2 §10](../spec-m2.md#10-legal-gdpr-and-rouvy)). A short DPIA under GDPR Art. 35, which **doubles as the assessment Québec's Law 25 requires (s. 17)** before personal information leaves Québec. Drafted, not legal advice: the maintainer reviews and owns it.

**Last reviewed:** _(date of the maintainer's review)_ · **Review again:** when the processing changes, the instance leaves the allow-list, or Rouvy answers the permission request.

## Why a DPIA

Health data (heart rate) is processed, and riders hand over credentials to a third party. Neither is large scale here, so a DPIA may not be strictly required, but it's cheap, Law 25 needs the s. 17 assessment anyway, and it forces the risks into writing.

## What is assessed

The processing described in the [record of processing](record-of-processing.md): reading an invited rider's own Rouvy rides for their MCP client. Three steps carry the risk:

1. **Credential handover:** the rider types their Rouvy email and password on our sign-in page.
2. **Token custody:** the instance keeps the rider's Rouvy refresh token for up to 30 days of disuse.
3. **Egress to Rouvy:** the instance signs in to Rouvy and reads from its private API on the rider's behalf, from one shared Cloudflare egress.

**Necessity and proportionality.** Rouvy has no public API or OAuth for third parties, so a sign-in on the rider's behalf is the only way to offer this to riders who can't run the stdio server. The data kept is the minimum that makes it work: one encrypted refresh token, the uid it belongs to, and the email the allow-list is checked against. Ride data is never stored. Riders who'd rather not hand over credentials can run `npx rouvy-mcp` locally, or host their own.

## Risks and measures

Likelihood and severity are rated low, medium or high, **after** the measures.

### 1. Credential handover

| Risk | Measures | Residual |
|---|---|---|
| The password is stored, logged or leaked by the instance. | Used once, sent to Firebase over TLS, then discarded; never in KV, logs or `props`. Firebase error bodies are never shown or logged. | Low |
| The sign-in page is used to test stolen passwords against Firebase from our egress. | The allow-list is checked on the typed email **before** any Firebase call. | Low |
| A malicious client tricks a rider into connecting it. | The page names the client, its verified domain and the redirect host, all escaped; consent is asked on every sign-in; the OAuth provider validates redirect URIs and PKCE. | Low |
| The rider doesn't understand the risk to their own Rouvy account. | The first checkbox says Rouvy's terms (§7.c, §14.a.vi) may not allow this and that Rouvy could restrict their account; neither box is pre-ticked. | Medium: it's the rider's informed choice. |

### 2. Token custody

| Risk | Measures | Residual |
|---|---|---|
| A KV dump exposes refresh tokens. | Each token is encrypted in the Grant's `props` with a per-Grant key wrapped by that Grant's own OAuth tokens. There is no server-side key: a KV dump alone reveals nothing. | Low |
| The operator, or someone in their Cloudflare account, uses a rider's token in the background. | By construction the token can only be unwrapped while serving one of that rider's requests; there is no admin route. | Low |
| A token leak is suspected. | The [token-leak runbook](../runbooks/token-leak.md): delete the namespace, redeploy, tell riders to change their Rouvy password (which revokes every Firebase refresh token), assess notification within 72 h. | Low |
| Tokens are kept longer than needed. | Grants are deleted after 30 days idle; a password change ends them all; erasure on request ([kill one rider](../operations.md#kill-one-rider)). | Low |

### 3. Egress to Rouvy

| Risk | Measures | Residual |
|---|---|---|
| Rouvy restricts riders' accounts because of the instance's traffic. | Read-only; the politeness charter across the whole instance (one queue, 1 s between requests, a shared cool-down); an honest user agent and our own `CF-Worker` zone, so Rouvy can recognise and block us; written permission requested. | Medium: Rouvy's terms decide. |
| Rouvy objects or blocks, and riders' access breaks in a way that harms them. | The **Hard stop**: within 24 h the instance closes, every Grant is deleted and riders are emailed ([runbook](../runbooks/hard-stop.md)). No evasion: no IP rotation, no disguised UA, no host moves. | Low |
| Ride data (health data) is kept or reused. | In memory only, dropped after 30 minutes idle; never logged; only used for what the rider asked (the Data Act Art. 6 duties, which `/privacy` commits to). | Low |

## Law 25, s. 17: information leaving Québec

The operator is in Québec. Riders' information is held by Cloudflare: the Durable Object that handles ride data in the EU, and the encrypted Grants in KV, globally.

- **Sensitivity:** the refresh token gives read access to a rider's rides; ride data includes health data. Both are sensitive.
- **Purpose:** only reading the rider's own rides for their client, at their request.
- **Protection:** the measures above; Cloudflare as processor under its DPA, with its security certifications (ISO 27001, SOC 2); the token encrypted with no key held by anyone but the rider's client.
- **Legal regime where it goes:** the EU, under GDPR; elsewhere in Cloudflare's network, covered by its DPA and standard contractual clauses.

**Conclusion:** the information will receive protection equivalent to that under Law 25. The transfer may go ahead, under the DPA.

## Conclusion

With the measures above the residual risk to riders is **low**, apart from the risk to their own Rouvy account under Rouvy's terms, which is **medium**, disclosed on the sign-in page, and accepted by each rider. No prior consultation (Art. 36) is needed. The processing may start once Cloudflare's DPA is accepted and the breach log exists.
