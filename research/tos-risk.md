# Rouvy terms of service and reverse-engineering risk

Research for [#3](https://github.com/scastiel/rouvymcp/issues/3) (map: [#1](https://github.com/scastiel/rouvymcp/issues/1)).
Sources read on 2026-10-24. **This is not legal advice.** It is an engineer's reading of public documents, written for the project's disclaimer and design choices. The project owner has already accepted the risk.

## TL;DR

- Rouvy's Terms of Use **expressly prohibit** what this project does: reverse engineering, and "any automated means for accessing and using ROUVY (including, without limitation, robot, spider, scraper)" (§29.h). They also forbid sharing sign-in data with "any other person" (§7.c, §14.a.vi).
- The contractual remedies are **account suspension and rescission of the user agreement without refund**, plus a reserved right to claim damages (§15.a, §7.d, §29.d). Czech law governs (§33.a); the Czech text is the binding one (§37.b).
- The risk falls mainly on **each user's own Rouvy account**, not on the project. It's a contract between the user and Rouvy. For a local-first, read-only, personal-use tool, the realistic risk is low but not zero: the account can be suspended, or the private API can change or be blocked.
- **No developer program or public API exists** (`rouvy.com/developers` returns 404). Rouvy only has partner integrations (Strava, Garmin Connect, TrainingPeaks, Intervals.icu, Terra).
- **No evidence found of Rouvy acting against unofficial tools.** At least one comparable open-source project, [mikejhill/home-assistant-rouvy](https://github.com/mikejhill/home-assistant-rouvy), has been public since Feb 2026 and is still active (it even writes data back).
- A **hosted multi-user instance is materially riskier**. Users would hand their Rouvy password to a third party (§7.c, §14.a.vi). The operator would run one server that makes automated calls for many accounts (§29.h.v, §29.h.iii). Any monetisation would hit the commercial-use bans (§14.a.iii–iv, §29.i).

## Primary sources

| Document | URL | Version |
| --- | --- | --- |
| Terms of Use / "Business Terms and Conditions" (TCC), English | https://rouvy.com/en/terms-of-use | "This version of the TCC enters into force on September 1, 2026 in regard to existing Users." (§37.l) |
| Terms of Use, Czech (binding) | https://rouvy.com/cs/terms-of-use | same page family |
| Privacy Policy | https://rouvy.com/en/privacy-policy | "Effective Date: 13.12.2024" |
| robots.txt | https://rouvy.com/robots.txt | fetched 2026-10-24 |
| Integrations page | https://rouvy.com/en/integrations | — |
| Intervals.icu help article | https://support.rouvy.com/hc/en-us/articles/35523188955793-ROUVY-and-Intervals-icu | — |

The provider and contracting party is **VirtualTraining s.r.o.**, Rohanské nábřeží 693/10, 186 00 Prague 8, Czech Republic (TCC §2.b).

## Key clauses (quoted verbatim, English TCC)

### Automated access and reverse engineering: §29 "Licence"

> **29.a.** The Provider grants to the User a non-exclusive, personal, limited, restricted to the purpose defined in the TCC, and time-limited (based on the type of Subscription) license for non-commercial purposes […] to use ROUVY in accordance with the TCC.

> **29.f.** The User must refrain from using ROUVY for purposes other than specified in the TCC, rules specified directly in the ROUVY application, and instructions given directly by the Provider.

> **29.h.** The User must refrain from carrying out the foregoing in regard to ROUVY:
> **29.h.i.** bypassing, switching off, damaging any function or feature whatsoever;
> **29.h.ii.** reverse engineering, reverse analysis or recompilation, disassembly, decompilation, modification, or any tampering with the source code, accessing the source code, or making the source code accessible to a third party;
> **29.h.iii.** penetration testing or overloading ROUVY in excess of the average parameters specified by the Provider;
> **29.h.iv.** adding any code whatsoever;
> **29.h.v.** using any automated means for accessing and using ROUVY (including, without limitation, robot, spider, scraper).

> **29.i.** ROUVY is provided for personal purposes, and the User must refrain from using ROUVY for commercial purposes without prior written permission. Accordingly, the User must refrain from reselling ROUVY, transferring his/her rights to use ROUVY to any third party in any way whatsoever, lending, renting, making public, providing a license to ROUVY to third parties […]

> **29.d.** The Provider has the right to use commensurate means to verify compliance with the license granted to the User based on the TCC. In case that a violation of the license is ascertained, the Provider has the right to rescind the ROUVY Use Agreement, whereupon the User is not entitled to receive a refund for any payment whatsoever. Likewise, the rescission of the ROUVY Use Agreement in accordance with this paragraph does not preclude the right to claim from the User any loss or damage liable to be incurred in connection with a violation of the licensing conditions or the TCC by the User.

The **binding Czech version** ([cs](https://rouvy.com/cs/terms-of-use)) is a condensed text. Its equivalent of §29.h reads:

> **29.h.** Je zakázáno reverzní inženýrství, zásahy do zdrojového kódu nebo používání automatizovaných prostředků (botů).

(Our translation: "Reverse engineering, interference with the source code, or use of automated means (bots) is prohibited.") The meaning matches the English text.

### Credentials: §7 "User Account Password" and §14.a.vi

> **7.c.** It is expressly stipulated that ROUVY is provided to a specific person, and the User is prohibited from sharing his/her password with any other person, regardless of the reason.

> **7.d.** If the password is shared with a third party, the User may be prevented from access to the User Account, and the Provider may unilaterally, effective immediately rescind the ROUVY Use Agreement, whereupon the User will have no right to receive any refund whatsoever. The Provider has the right to create a mechanism allowing determining whether the User deliberately shares his/her password.

> **14.a.vi.** The User must use his/her User Account personally and must refrain from providing sign in data for his/her User Account to any other person.

The local-first design doesn't share a password with *a person*: it stays on the user's machine, used by software the user runs. A hosted instance would put the password in a third party's hands, which is exactly what §7.c and §14.a.vi target.

### Personal, non-commercial use: §14.a

> **14.a.iii.** The User must always use ROUVY for personal purposes only.
> **14.a.iv.** If the User wishes to use ROUVY for commercial purposes, the User must notify the Provider and apply for prior consent […]
> **14.a.v.** The User must use ROUVY and all applications associated with ROUVY only in the manner described in the TCC, rules laid down directly in the ROUVY application, terms and conditions for the associated applications, and instructions given directly by the Provider.

### Consequences: §15

> **15.a.** If the User commits any violation of the TCC, acts in a manner liable to jeopardize the operation or good repute of ROUVY, harasses or harms other ROUVY Users, the Provider, or a third party, the Provider has the right to Suspend the User's User Account.
> **15.b.** The Provider must notify the User if the User's User Account is Suspended. […] If, however, the User makes a request to that effect, a substantiation will be given to the User within three working days after a request to that effect is made.

### Client version: §14.a.ii

> **14.a.ii.** The must download and install the most recent official updates of ROUVY. The User acknowledges that he/she may be prevented from using ROUVY if he/she fails to use the up-to-date version (build) of ROUVY.

This is relevant to API drift. Rouvy reserves the right to reject outdated clients, so the project should expect breakage.

### Governing law, binding language, amendments: §37, §36

> **37.b.** The Business Terms and Conditions, the Privacy Policy, the Contest Rules, and other texts are binding in the Czech version. Any version in a language other than Czech is informal only and intended solely for information purposes only.

> **36.c.** Unless otherwise specified in a notice, an amendment enters into force 10 days after being posted on the website.

Governing law (§33.a): "The ROUVY Use Agreement […] is entered into on the basis and in accordance with the law of the Czech Republic."

### Data ownership: §18.h "User Content"

> User Content remains the exclusive property of the User at all times. Likewise, the User retains the full ownership of intellectual property rights to User Content.

"User Content" is defined (§2.g) as "Any and all information uploaded by the User to the ROUVY environment […] User Content mainly includes data, texts, videos, images, files, routes with geographic mapping, and graphics". A user's own ride data arguably falls under it. That supports the "it's your own data" framing, but it doesn't override §29.h's ban on *how* you access it.

## Privacy policy: data-subject rights (a legitimate access path)

From the [Privacy Policy](https://rouvy.com/en/privacy-policy):

> If you are an EEA resident, you have the right to access your personal data we keep on file and the right to request correction, erasure, and transmission of your personal data. […]
> If you have provided your personal data based on your consent, you have the right to request from us a copy of such data in a structured, machine-readable format and to request us to share (transmit) your personal data with another data controller.

> […] you have the right to the portability of your personal data […] If you want to exercise any of these rights, sign in to your account and modify your profile settings accordingly. Alternatively, you can contact us using the contacts provided below.

> Kindly keep in mind that the above rights are limited, for example if complying with your request were to have an adverse effect on other persons or the trade secret or intellectual property of VirtualTraining s.r.o. […]

Contact: `gdpr@rouvy.com`. The policy lists "Creating a ROUVY user account and providing ROUVY services — Information on account registration and training data" with legal basis "Required for performing the agreement". Training data is processed under contract, not consent. GDPR Art. 20 portability applies to both bases, but the policy's wording ties the machine-readable copy to consent. In practice, this route is a one-off manual request, not a live API. It's still worth naming in the README as the "fully sanctioned" way to get your data.

## Official and partner integrations

- **No public developer API or program.** `https://rouvy.com/developers` returns 404, and `developers.rouvy.com` redirects to the homepage (checked 2026-10-24).
- **Official integrations** ([rouvy.com/en/integrations](https://rouvy.com/en/integrations)): Strava, Garmin Connect, TrainingPeaks, Intervals.icu. The [Intervals.icu support article](https://support.rouvy.com/hc/en-us/articles/35523188955793-ROUVY-and-Intervals-icu) says "ROUVY supports exporting your ROUVY activities to Intervals.icu", with auto-sync after each ride. Intervals.icu has a public, documented API. So **Rouvy → Intervals.icu → Intervals.icu API** is a ToS-clean route to the same Activity data. It just isn't Rouvy-native.
- **Terra** ([tryterra.co/integrations/rouvy](https://tryterra.co/integrations/rouvy)), a commercial health-data aggregator, advertises a Rouvy integration where "Rouvy notifies Terra whenever new data is available". That suggests Rouvy runs a partner/webhook API for vetted partners. A hosted instance might eventually ask Rouvy for partner access instead of scraping.

## robots.txt

[rouvy.com/robots.txt](https://rouvy.com/robots.txt) allows general crawling, apart from `/sign-in?`, `/login?`, `/*/search?`, `/events/` and `/deeplinks*`. It blocks a list of SEO bots outright. robots.txt targets crawlers, not authenticated API clients, and it doesn't change the TCC. It doesn't affect this project.

## Has Rouvy acted against unofficial tools?

I found no public evidence of takedowns, DMCA notices, cease-and-desist letters or account bans tied to third-party tools. Searches of the web and of GitHub (including [github/dmca](https://github.com/github/dmca), via search for "rouvy") turned up nothing.

Counter-evidence (tools that exist and are still up):

- **[mikejhill/home-assistant-rouvy](https://github.com/mikejhill/home-assistant-rouvy)**: created 2026-02-16 and still active (updated 2026-10-21). It ships an async Python client and a `rouvy-api` CLI against the riders.rouvy.com web routes, with email/password login, and includes **write** actions (update weight, FTP, zones, register for events). Its README says: "Rouvy has no public API. This project uses the same data routes as the riders.rouvy.com website, politely (hourly) and with a user agent that identifies the project." Its [project charter](https://mikejhill.github.io/home-assistant-rouvy/project-charter/) commits to "Only call routes the official web app calls, at a polite rate (hourly polling, at most four concurrent requests)", to a user agent "that names this project", and to "Never impersonate a browser and never try to get around Rouvy's bot protection." That's a good precedent for our own politeness policy.
- **[mikebarkmin/rouvy-tools](https://github.com/mikebarkmin/rouvy-tools)** ("Tools which make working out in Rouvy better") and several Linux/Wine and trainer-bridge projects (e.g. [jelmer/rouvy-wine](https://github.com/jelmer/rouvy-wine), [evanjt/rouvy-linux](https://github.com/evanjt/rouvy-linux)) are public with no sign of action against them.

Absence of evidence is weak evidence. Rouvy may simply not have noticed, and suspensions of individual accounts wouldn't necessarily be public. The charter's mention of "Rouvy's bot protection" suggests Rouvy's web stack has some anti-bot layer. That's a technical risk rather than a legal one.

## Risk assessment (plain language, not legal advice)

**Local-first, read-only, personal use (M1)**

| Risk | Likelihood | Impact | Notes |
| --- | --- | --- | --- |
| A user's Rouvy account is suspended or terminated for automated access (§29.h.v, §15.a, §29.d) | Low | High for that user (loses subscription, no refund) | Read-only, low volume and the user's own data make it hard to detect and unlikely to be prioritised. Risk grows with polling frequency. |
| Rouvy claims damages from a user (§29.d) | Very low | Medium | Requires demonstrable loss; implausible for read-only personal use. |
| Action against the project or maintainer (takedown, C&D) | Low | Medium (repo removal) | The maintainer isn't a party to other users' contracts. A copyright/DMCA claim needs copied Rouvy code or content, so the repo shouldn't contain any (no copied JS bundles, no route media). A contract claim would only reach the maintainer through their own account (recon). |
| Private API changes or blocks non-browser clients (§14.a.ii, bot protection) | Medium–High over time | Tool breaks | The main practical risk. Belongs to the "resilience to API drift" fog item. |
| Credential exposure | Depends on design | High | §7.a makes the user responsible for keeping the password confidential. Prefer storing a session or refresh token over a plain password, and keep it out of logs. |

**Public hosted instance (later effort)**: risk goes up a level.

- Users would give their Rouvy sign-in data to the operator. That's a direct conflict with §7.c ("prohibited from sharing his/her password with any other person, regardless of the reason") and §14.a.vi. Rouvy reserves the right to build detection for this (§7.d).
- One operator making automated calls on behalf of many users is the plain case of §29.h.v. It's also more visible: one IP range and higher volume, with §29.h.iii (overloading) in play.
- Any paid tier or ads would add the commercial-use bans (§14.a.iii–iv, §29.i).
- The operator would become a data controller/processor for users' health-adjacent data under GDPR, with all that entails.
- Mitigations to explore then: ask Rouvy for partner API access (the Terra integration shows they have one); go through Intervals.icu/Strava/Garmin official APIs; or keep the hosted version "bring your own token" with nothing stored server-side. None of these removes the ToS issue except official partner access.

**EU/Czech law angle (untested, flagged only).** The EU Software Directive (2009/24/EC, Arts. 5–6) lets the user of a program observe its behaviour and, in narrow cases, decompile it for interoperability. Those rights can't be waived by contract. They concern *computer programs*, though, not access to a hosted service's API, and they don't obviously make §29.h.v unenforceable. Don't rely on this without a lawyer.

## Design implications for the project

1. **Disclaimer** (below) in the README, the npm package description and the server's MCP `instructions`/about text.
2. **Read-only by construction.** No mutating endpoints in the client, so §29.h.i/iv ("bypassing… any function", "adding any code") can't come into play.
3. **Behave like one human user.** Only call routes the web app itself calls. Use low concurrency, cache aggressively, and never poll in the background unless asked. Never get around bot protection or CAPTCHAs. Consider an honest, identifying user agent (as home-assistant-rouvy does). This trades a little stealth for good faith, and the owner should decide.
4. **No Rouvy code or content in the repo.** No vendored or bundled JS, no route videos or images, and redacted fixtures only. This keeps copyright claims (§31, §29.g) off the repo itself.
5. **No password at rest where avoidable** (already in the map's risk stance). This also supports §7.a.
6. **Point to sanctioned alternatives** in the README: the Intervals.icu sync and the GDPR access/portability request to `gdpr@rouvy.com`.

## Suggested disclaimer text

> **Unofficial project.** rouvymcp is not affiliated with, endorsed by, or supported by ROUVY or VirtualTraining s.r.o. "ROUVY" is a trademark of its owner.
>
> Rouvy has no public API. This tool talks to Rouvy's private web API with **your own** account, from **your own** machine, and only reads data. Rouvy's [Terms of Use](https://rouvy.com/en/terms-of-use) (§29.h) prohibit reverse engineering and "using any automated means for accessing and using ROUVY". Using this tool may breach those terms, and Rouvy may suspend or terminate your account without a refund (§15, §29.d). The API may change or stop working at any time.
>
> **Use at your own risk.** The software is provided "as is", without warranty of any kind (see LICENSE). The authors aren't responsible for any consequences to your Rouvy account or data. Nothing here is legal advice.
>
> If you'd rather stay within Rouvy's terms, use Rouvy's official integrations (e.g. Intervals.icu, Strava, Garmin Connect) or request a copy of your data from Rouvy under the GDPR (gdpr@rouvy.com).

## Open questions surfaced

- **Sanctioned data paths as an alternative backend.** Could M1 (or a later mode) read Activities from the Intervals.icu API, since Rouvy officially syncs there, instead of from Rouvy's private API? How complete is that data (per-second streams, Rouvy-specific fields)?
- **GDPR access/portability request.** Worth one real request to `gdpr@rouvy.com` to see what format and fields Rouvy returns (and how fast). It could be an "import from export" fallback.
- **Partner API access.** Terra's integration implies a partner/webhook API. Is it worth asking Rouvy directly, especially before any hosted instance?
- **User-agent policy.** Identify the project honestly (good faith, easier to block) or mirror the browser (stealthier, but closer to "bypassing")? This is a decision for the politeness/caching fog item.
- **Hosted-instance credential custody** conflicts head-on with §7.c/§14.a.vi. This needs its own decision when the hosted effort starts.
