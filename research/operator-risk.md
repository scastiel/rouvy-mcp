# Operator risk for a public rouvy-mcp instance

Research for [Operator risk for a public instance: Rouvy ToS, GDPR, official integrations](https://github.com/scastiel/rouvymcp/issues/29) (map: [Map: Hosted Rouvy MCP server — milestone 2 (web auth)](https://github.com/scastiel/rouvymcp/issues/28)).
Sources read on 2026-10-25. **This is not legal advice.** It's an engineer's reading of public documents, written to inform a go/no-go and the M2 design.

This builds on the M1 ToS research on branch [`research/tos-risk`](https://github.com/scastiel/rouvymcp/blob/research/tos-risk/research/tos-risk.md). Its clause quotes (Rouvy TCC §7.c, §7.d, §14.a, §15, §29) aren't repeated here. They are cited by section number only.

## Verdict: amber

A public instance that is **invite-only, free, small, honest and quick to stop** is **amber**. It's a real and accepted risk, not a blocker. It turns **red** if any of these happen:

- it opens to the public at scale without Rouvy's written permission;
- it keeps running after Rouvy objects;
- it stores Activity data at rest without the GDPR basics in place.

**Don't shrink the route to self-host-only now.** Do make "Rouvy says no" or "Rouvy sends a letter" a hard stop that shrinks it to self-host-only. Also make Rouvy's written permission a precondition for leaving the allow-list.

Why amber, not green:

1. **The ToS bite harder on the hosted case, and the honest UA makes it visible.**
   - Riders handing sign-in data to a third party is what §7.c and §14.a.vi forbid. Rouvy reserves the right to detect it (§7.d).
   - Keeping only the Firebase refresh token doesn't change that. The token *is* sign-in data in effect: it mints sessions without the password.
   - One server making automated calls for many accounts is the plain case of §29.h.v.
   - The M1 honest user agent (`docs/spec-m1.md`, "Honest user agent") means Rouvy can attribute and block every request from the instance in one rule. That's good faith, and it's also maximum visibility.
2. **The penalty lands on riders, not on the operator, at first.** Rouvy's remedies are suspension or rescission of *the rider's* account without refund (§15.a, §7.d, §29.d).
   - The operator isn't a party to riders' contracts. It is party to its own account's contract.
   - The operator's exposure grows sharply only if Rouvy *revokes permission* and the operator keeps going. That's the Power Ventures pattern below.
3. **GDPR makes the operator a controller of health data.** That brings a fixed set of obligations: explicit consent, a privacy notice, records, security, a DPA with the host, and possibly a DPIA. None is hard at invite-only scale, but each must be done before the first non-maintainer rider signs in.

Why not red:

- I found no evidence of Rouvy acting against unofficial tools (M1 research, re-checked).
- A commercial aggregator, Terra, runs a per-user Rouvy integration in which "users authenticate with their own Rouvy login" (below).
- The data is the rider's own. The instance is read-only, and the scale is tiny.

## 1. Official paths: is there an OAuth or a partner API?

**No public one.** Re-checked 2026-10-25:

| URL | Result |
| --- | --- |
| `https://rouvy.com/developers` | 404 |
| `https://developers.rouvy.com` | 301 → `https://rouvy.com/` |
| `https://api.rouvy.com` | 404 |
| `https://rouvy.com/.well-known/openid-configuration` | 404 |
| `https://riders.rouvy.com/.well-known/oauth-authorization-server` | 404 |

- **No "Sign in with Rouvy."** The [Partners page](https://rouvy.com/en/partners) lists hardware, brand and sponsorship partners only, with no software or API programme and no way to apply.
- **The [Integrations page](https://rouvy.com/en/integrations)** lists Strava, Garmin Connect, TrainingPeaks, Intervals.icu, CoachCat, COROS, Final Surge, Humango, Map My Fitness, Ride with GPS, Relive, Suunto, Wahoo, Xert and others. It sends riders to "Connect ROUVY with Your Fitness Apps" in riders.rouvy.com settings.
- **How the integrations work.** In every case documented, **the rider connects the partner from inside Rouvy and Rouvy pushes rides out** to the partner's public API ("ROUVY activities sync into Garmin Connect", "completed ROUVY workouts appear on the Final Surge calendar"). Workouts flow in from partners that have APIs (Xert, Intervals.icu, Humango).
  - The [Garmin press release](https://rouvy.com/en/press/rouvy-syncs-with-garmin-connect) (2022) describes Rouvy as one of "Garmin's training data partners". Rouvy is the *client* of Garmin's API there, not the other way round.
  - The Rouvy help article on Intervals.icu (`support.rouvy.com/.../35523188955793`) returned 403 to automated fetches today. The M1 research quoted it: "ROUVY supports exporting your ROUVY activities to Intervals.icu", with auto-sync.
  - So **no integration documents a third party pulling from Rouvy with an OAuth grant.** Rouvy is a data *source* that pushes, not a platform that grants access.
- **Terra is the one exception.** The [Terra Rouvy page](https://tryterra.co/integrations/rouvy) says:
  - "Users authenticate with their own Rouvy login through the Terra widget"
  - "No provider credentials are required"
  - "Rouvy does not notify Terra when data changes, so Terra polls it every 5–10 minutes for each connected user"

  This **corrects the M1 research**, which read Terra as "Rouvy notifies Terra". Terra polls on a per-user login, which is a hosted, multi-user, credential-based pull, the same shape as our public instance. The page doesn't say whether Terra has a contract with Rouvy. "No provider credentials" means Terra's customers need no Rouvy API key. It doesn't tell us Terra lacks one.

**Implication for M2:** the map's default stands. The rider types their Rouvy email and password into our sign-in page, and we keep only the refresh token. No official OAuth exists to use instead. A "paste a token" path doesn't help the ToS position: it's still sign-in data handed to a third party. Its only gain is that the operator never sees the password, which reduces breach impact.

## 2. ToS clauses that bite on the hosted case

Rouvy TCC, version in force since 2026-09-01: https://rouvy.com/en/terms-of-use. The Czech text is binding (§37.b). Verbatim quotes are in the M1 research.

| Clause | M1 (own account, own machine) | Public instance |
| --- | --- | --- |
| §7.c / §14.a.vi: no sharing the password or "sign in data" with "any other person" | Not triggered. The software is the rider's own. | **Triggered.** The operator holds the rider's refresh token, and sees the password during sign-in. |
| §7.d: Rouvy may build a mechanism to detect sharing; immediate rescission | Hard to tell apart from normal use | **Easy to detect.** Many accounts come from one egress IP with one honest UA. |
| §29.h.v: "any automated means for accessing and using ROUVY" | Triggered (accepted in M1) | Triggered, at operator scale |
| §29.h.iii: overloading beyond average parameters | Not realistic | A theoretical risk. Mitigated by the politeness budget (map "Not yet specified"). |
| §14.a.iii–iv, §29.i: personal and non-commercial use only; no "making public" or transferring rights without written permission | Fine | Free and no ads, so the commercial bans aren't hit. "Making public" is about ROUVY itself, not the rider's data, so it's a weak fit. §29.i is also the **door**: Rouvy can grant "prior written permission". |
| §15.a: acting "in a manner liable to jeopardize the operation or good repute of ROUVY" | Unlikely | A credential breach at the instance would plausibly qualify, for every affected rider |

**Who carries the risk.** All of these are obligations of *the rider* toward Rouvy. Riders on the public instance knowingly break §7.c and §14.a.vi by signing in. The sign-in page must say so plainly (mitigations below).

The operator's direct contractual exposure is limited to its own account. A claim against the operator would have to be in tort, unfair competition or computer-misuse law rather than contract. None is tested here, and US precedent (below) shows that the *revocation of permission* is what turns a ToS problem into a legal one.

## 3. GDPR: the operator's role and obligations

Regulation (EU) 2016/679: https://eur-lex.europa.eu/eli/reg/2016/679/oj

### Role: controller

- The rider uses the instance for their own purposes. Each rider's personal use is covered by the household exemption (Art. 2(2)(c), Recital 18), so the rider is not a controller.
- Recital 18 adds that the Regulation still "applies to controllers or processors which provide the means for processing personal data for such personal or household activities". That's exactly our operator.
- The operator decides why (bridging Rouvy to MCP) and how (what is fetched, stored and kept, for how long). That makes it the **controller** under Art. 4(7) as read by [EDPB Guidelines 07/2020 on controller and processor](https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-072020-concepts-controller-and-processor-gdpr_en). It isn't anyone's processor: no controller instructs it.
- **Rouvy (VirtualTraining s.r.o.) stays a separate controller** of its own copy. The operator isn't Rouvy's processor and has no contract with it.
- The **hosting provider is the operator's processor.** It needs an Art. 28 DPA. Mainstream hosts publish one with their terms. Pick an EU region, or a host covered by an adequacy decision or SCCs, to avoid Chapter V transfer work.

### Does "only proxying" count?

Yes. Art. 4(2) defines processing as including "retrieval, consultation, use, disclosure by transmission". Passing Activity data through memory without storing it is still processing. Storing nothing but the refresh token minimises what's *at rest*, but it doesn't take the instance out of scope.

### Is it health data (Art. 9)?

Treat it as **yes**.

- Art. 4(15) defines "data concerning health" as data "related to the physical or mental health of a natural person … which reveal information about his or her health status".
- The [Article 29 Working Party's 2015 annex on health data in apps and devices](https://ec.europa.eu/justice/article-29/documentation/other-document/files/2015/20150205_letter_art29wp_ec_health_data_after_plenary_annex_en.pdf) (paraphrased: I couldn't extract the PDF text today) treats raw sensor data as health data when it can be used, alone or combined, to draw conclusions about health status. Heart rate is its standard example.
- The CJEU has since read Art. 9 broadly. In *OT* (C-184/20, 2022) and *Lindenapotheke* (C-21/23, 4 October 2024), data that reveals health status "by collation or deduction", even with some likelihood, is special-category data. Commentary: [Taylor Wessing](https://www.taylorwessing.com/zh-hant/insights-and-events/insights/2024/10/ecj-lindenapotheke), [MediaLaws](https://www.medialaws.eu/comment-on-cjeu-c-21-23-lindenapotheke/). I didn't read the judgment text itself.
- Heart-rate series, FTP, weight and HR zones from Rider settings sit squarely in that zone. Power on its own is more arguable.
- Rouvy's own [Privacy Policy](https://rouvy.com/en/privacy-policy) (effective 13.12.2024) doesn't use the words "health" or "special category". It collects "height, weight, and date of birth to control the trainer and calculate zones and FTP" and relies on contract. That's Rouvy's position. It doesn't bind ours.

**Legal basis**

- **Art. 6(1)(b), contract.** Our terms with the rider are to provide the bridge they asked for.
- **Art. 9(2)(a), explicit consent.** No other Art. 9(2) ground fits. Art. 9(2)(e) "manifestly made public" doesn't: the data is private to the account.
- Consent must be specific, informed, unambiguous and withdrawable (Art. 7). Use a separate checkbox on the sign-in page, not bundled with the terms. Withdrawal means deleting the token.

**Location.** Rouvy rides are mostly indoor. The GPS tracks in an Activity are usually the *virtual route's* coordinates, not the rider's real whereabouts. Activities synced in from Garmin, Suunto or Wahoo may be real outdoor tracks. Location isn't Art. 9, but the [EDPB-endorsed DPIA guidelines (WP248 rev.01)](https://ec.europa.eu/newsroom/article29/items/611236) count location as "highly personal". Minimisation helps here: return no coordinates unless a tool needs them.

### Obligations checklist for the operator

| Obligation | Article | What it means at invite-only scale |
| --- | --- | --- |
| Privacy notice | Art. 13 | One page: who runs it, what is fetched and kept (the refresh token, any caches), the legal bases, retention, the host as processor, rights, and how to delete. Feeds the map's "Public-facing legal pages" item. |
| Explicit consent for health data | Art. 9(2)(a), Art. 7 | A separate checkbox at sign-in. Withdrawal is one click (revoke, then delete the token). |
| Data minimisation and storage limitation | Art. 5(1)(c), (e) | Store only the encrypted refresh token plus the minimal grant record. Keep Activity caches in memory with short TTLs, never on disk. Delete a token on revoke, on sign-out, after N days unused, and when Rouvy rejects it. |
| Security | Art. 32 | Encrypt tokens at rest with a key outside the database. No secrets, ids or bodies in logs (the M1 rule). TLS. Least-privilege hosting account. |
| Breach notification | Art. 33, 34 | A leaked token store means notifying the supervisory authority within 72 h, and probably every rider, since it's high risk: their Rouvy accounts are takeover-able. Plan the token-revocation story. Riders can kill a Firebase refresh token by changing their Rouvy password. |
| Records of processing | Art. 30 | The under-250-staff exemption (Art. 30(5)) **doesn't apply** when special categories are processed. Keep a one-page record. |
| DPIA | Art. 35 | WP248 says two or more criteria usually call for a DPIA. "Sensitive data" plus "highly personal" location are arguably two. A short written DPIA is cheap insurance. Not "large scale" at invite-only size. |
| Processor contract | Art. 28 | Accept the host's DPA. Prefer EU hosting. |
| Data-subject rights | Art. 15–22 | Access, export and erasure come almost free if nothing but the token is stored. |
| EU representative, if the operator isn't established in the EU | Art. 3(2), Art. 27 | GDPR still applies when offering a service to riders in the EU. Art. 27(2)(a) exempts "occasional" processing that doesn't include "large-scale" special categories and is unlikely to result in a risk. An invite-only instance arguably fits; an open one may not. Check where the operator is established. Local law (e.g. a non-EU privacy statute) may add duties. |

## 4. Precedents: hosted bridges to platforms without a public API

| Case | What happened | Lesson |
| --- | --- | --- |
| **Facebook v. Power Ventures** (9th Cir. 2016, 844 F.3d 1058). Summaries: [Mintz](https://www.mintz.com/insights-center/viewpoints/2016-07-19-facebook-v-vachani-user-authorization-can-be-revoked-service), [Eric Goldman](https://blog.ericgoldman.org/archives/2017/09/catching-up-on-ninth-circuit-cfaa-jurisprudence-internet-law-casebook-excerpt.htm) | An aggregator logged in with users' credentials, at their request. Facebook sent a cease-and-desist letter and **blocked Power's IP**. Power switched IPs and continued. The court held that users' permission was enough at first, and that a ToS breach alone isn't a CFAA violation. **Continuing after the letter** was unauthorised access, with damages. | The escalation path is a letter, then an IP block, then liability for carrying on. It's US law, but the logic is general: **stop the moment the platform objects.** Never rotate IPs or evade a block. |
| **Zwift, May 2018** ([Zwift Insider](https://zwiftinsider.com/zwiftpower-and-gdpr)) | Zwift asked every developer using its (unofficial) APIs to "stop doing so by May 25th" and to "delete any personal data related to Zwift users collected through our APIs", citing GDPR. ZwiftPower and other community services went dark for a while. | A platform's own GDPR posture is a ready reason to shut third parties out. **Rouvy can do the same overnight.** |
| **Garmin Connect** | Garmin effectively closed its free Connect API to third parties without notice around Feb 2014 ([DC Rainmaker](https://dcrainmaker.com/2014/06/counterpoint-garmin-sync.html)). In 2026 it changed its auth flow and the widely used unofficial client was abandoned: "Garmin changed their auth flow, breaking the mobile auth approach that Garth depends on" ([garth docs](https://garth.readthedocs.io/en/latest/)). Users report `python-garminconnect` login 401s ([issue #332](https://github.com/cyberjunky/python-garminconnect/issues/332)) and 48 h+ login rate-limit blocks ([Garmin forum](https://forums.garmin.com/developer/fit-sdk/f/discussion/435087/persistent-429-on-api-login-account-blocked-for-48-hours/2029273)). | The common outcome is **technical** (an auth change or bot protection), not legal. A hosted instance concentrating many logins on one IP is the first thing to get rate-limited, and the block hits every rider at once. |
| **Terra and Rouvy** ([tryterra.co](https://tryterra.co/integrations/rouvy)) | A commercial, hosted, multi-user per-login poller of Rouvy, advertised openly. | Either Rouvy tolerates or contracts this shape, or hasn't noticed. Either way it's evidence the shape isn't instantly fatal, and a hint that **asking Rouvy** is plausible. |
| **home-assistant-rouvy** (M1 research) | A self-hosted, per-user, honest-UA client. Public since Feb 2026, no action seen. | The self-host route matches a precedent that has survived. |

**Not found:** any public Rouvy letter, takedown or ban aimed at a third-party tool. The 2026-10-24 search was re-run in spirit today, with nothing new.

## 5. Mitigations, ranked by how much they move the needle

1. **Written permission from Rouvy (§29.i).** This is the only thing that removes the ToS problem, and it would also unlock a sanctioned data path. The route is the contact form or the `gdpr@rouvy.com` / partner channel.
   - *Caveat:* asking makes the project visible, and a "no" turns any further running into the Power Ventures position. Ask **before opening the allow-list**, not necessarily before an invite-only beta.
2. **A hard stop commitment, written in the README and the ops runbook.** On any objection from Rouvy, or an IP block, the public instance shuts down and deletes every token within 24 h. No IP rotation, no workaround. This is the single biggest legal-risk reducer.
3. **Stay invite-only and small.** This keeps the Art. 27 and DPIA questions light, keeps request volume near "one human", and keeps §7.d detection unlikely to be prioritised.
4. **Informed rider consent at sign-in.**
   - A plain statement that signing in shares sign-in data with a third party, which Rouvy's §7.c and §14.a.vi forbid, and that Rouvy may suspend the account without refund.
   - Point to self-hosting and to Rouvy's official integrations as the alternatives.
   - A separate Art. 9 explicit-consent checkbox.
5. **Store nothing but the encrypted refresh token.** No Activity data at rest, in-memory caches only, short retention for unused tokens, and the M1 logging rules. This minimises both breach impact and GDPR surface.
6. **Offer a paste-token path, or a "change your Rouvy password to revoke" note.** This means the operator never sees passwords. It doesn't fix the ToS position, but it lowers the breach severity riders face.
7. **The GDPR paperwork:** the privacy notice, the Art. 30 record, the host DPA with EU hosting, and a short DPIA. Hours of work, not weeks.
8. **Keep self-host first-class, with docs and a one-click deploy.** Self-hosting is the M1 risk profile (own account, own infrastructure). It's the recommended path, and the fallback if the public instance stops.

Not recommended:

- Hiding the user agent or spreading over IPs. It looks like evasion (§29.h.i, the Power Ventures pattern) and contradicts the M1 politeness charter.
- Any paid tier, which would hit §14.a.iv and §29.i.

## 6. Should the route shrink to self-host-only?

**Not now.** An invite-only public instance with mitigations 2–7 in place is amber and within the map's stated risk appetite.

Build the shrink in as a **tripwire**, not a decision to revisit later:

- Rouvy objects, blocks the instance, or refuses permission → public instance off, self-host only.
- Opening beyond the allow-list → requires Rouvy's written permission first.

## Open questions surfaced

- **Ask Rouvy, and when?** Whether to contact Rouvy for written permission or partner access before the invite-only beta or only before opening it, and who sends it. Asking early is honest, but a "no" ends the public instance. This is a grilling-shaped decision for the maintainer.
- **The EU Data Act route.** Regulation (EU) 2023/2854 has applied since 12 Sept 2025. It gives users a right to have "related service" data of connected products shared with a third party they choose (Arts. 4–5). Rouvy controls smart-trainer resistance, which arguably makes it a "related service". If so, a rider-designated sharing request could be a *legal* access path. This is untested. The [Zwift forum debate](https://forums.zwift.com/t/zwift-and-the-upcoming-eu-data-act-third-party-api-access/606311) shows it's contested. Worth its own research ticket if the permission route fails.
- **Terra's footing.** Does Terra have a contract with Rouvy? If yes, Rouvy has a partner channel to ask about. If no, it's an even stronger tolerance precedent. One email to Terra or Rouvy would tell.
- **Operator establishment.** Where the operator is legally established decides whether the Art. 27 representative question and any local privacy law apply. This is a fact to record in the M2 spec, not to research further.
