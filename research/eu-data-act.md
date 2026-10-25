# EU Data Act as a legal access path to Rouvy ride data

Research for [EU Data Act as a legal access path to Rouvy ride data](https://github.com/scastiel/rouvymcp/issues/40) (map: [Map: Hosted Rouvy MCP server — milestone 2 (web auth)](https://github.com/scastiel/rouvymcp/issues/28)). It follows up on [Operator risk for a public instance: Rouvy ToS, GDPR, official integrations](https://github.com/scastiel/rouvymcp/issues/29) (findings on branch [`research/operator-risk`](https://github.com/scastiel/rouvymcp/blob/research/operator-risk/research/operator-risk.md)).

Sources read on 2026-10-25. **This is not legal advice.** It's an engineer's reading of the regulation, the Commission's FAQ and Rouvy's own pages. Whether Rouvy is a "related service" has not been tested by any authority or court that I could find.

## Verdict

- **Does it plausibly apply? Yes, plausibly, for the raw ride telemetry. It's arguable, not settled.** Rouvy sends resistance commands to the rider's smart trainer, a connected product. That fits both prongs of the Commission's "related service" test: two-way data exchange, and an effect on the product's operation. Rouvy is also too big for the small-enterprise exemption.
- **What it grants:** the rider can ask Rouvy for their *readily available* product data and related service data. Rouvy must provide it free, without undue delay, in a structured machine-readable format, and "where relevant and technically feasible, continuously and in real-time" (Art. 4(1)). The rider can also ask Rouvy to send it to a third party they name (Art. 5(1)). That covers raw and pre-processed data (power, cadence, speed, heart rate, position, timestamps) generated after 12 September 2025. It does **not** cover data Rouvy *derives* (its own scores, FTP estimates, rankings), and it does not cover route video, which counts as content.
- **Practicality: low for us, today.** It's a request-and-negotiate right, not a technical one.
  - Rouvy chooses the access mechanism. Nothing found shows Rouvy has a Data Act process; its privacy policy doesn't mention the Act.
  - The Czech enforcement authority wasn't confirmed as designated when last reported.
  - It gives no right to self-serve through Rouvy's private web API. Arts. 4(11) and 5(5) forbid "abus[ing] gaps in the technical infrastructure".
  - A third party that receives the data takes on Art. 6 duties.
  - Rouvy can ask the third party (not the rider) for cost-based compensation.
- **Should it change the route? No, not the build. It should change the *ask*.** The hosted server keeps its M1-style Session approach. The Data Act becomes the legal backbone of the "ask Rouvy for written permission" step from [Operator risk for a public instance: Rouvy ToS, GDPR, official integrations](https://github.com/scastiel/rouvymcp/issues/29). It reframes that step from "please tolerate our scraper" to "riders are exercising Art. 5 to name this service as their third party; let's agree a sanctioned mechanism." It's also a fallback for individual riders if Rouvy blocks the instance. It does **not** make the current ToS-breaching sign-in-data path lawful, and it doesn't lower the risks in the operator-risk verdict.

## 1. Does Rouvy fit the definitions?

### The smart trainer is a connected product

Art. 2(5) defines a connected product as "an item that obtains, generates or collects data concerning its use or environment and that is able to communicate product data via an electronic communications service, physical connection or on-device access, and whose primary function is not the storing, processing or transmission of data on behalf of any party other than the user" ([Regulation (EU) 2023/2854, EUR-Lex](https://eur-lex.europa.eu/eli/reg/2023/2854/oj/eng)).

A smart trainer measures power, cadence and speed and broadcasts them over Bluetooth or ANT+. That fits. Recital 14 explicitly lists "health and lifestyle equipment" and "consumer goods". A heart-rate strap fits the same way.

The Regulation covers manufacturers of products **placed on the market in the Union** and providers of related services (Art. 1(3)(a)), and **users in the Union** (Art. 1(3)(b)). Trainers bought in the EU from Wahoo, Garmin/Tacx, Elite and others qualify, for riders in the EU. A rider outside the EU probably isn't covered.

### Rouvy is plausibly a related service

Art. 2(6) defines a related service as "a digital service, other than an electronic communications service, including software, which is connected with the product at the time of the purchase, rent or lease in such a way that its absence would prevent the connected product from performing one or more of its functions, **or which is subsequently connected to the product by the manufacturer or a third party to add to, update or adapt the functions of the connected product**."

Recital 17 adds three points:

- Related services "should be understood to be explicitly linked to the operation of the connected product's functions, such as services that … transmit commands to the connected product that are able to have an impact on its action or behaviour."
- The Regulation "should also apply to a related service that is not supplied by the seller … but which is provided by a third party."
- "In the event of doubt as to whether the service is provided as part of the purchase, rent or lease contract, this Regulation should apply."

The Commission's FAQ (v1.4, 22 January 2026, Q10) sets out two conditions: "there must be a two-way/bidirectional exchange of data between the connected product and the service provider; and the service must affect the connected product's functions, behaviour, or operation." Its example is "an app to adjust the brightness of lights, or to regulate the temperature of a fridge." It lists factors for borderline cases: user expectations for the product category, marketing, contractual negotiations, "the replaceability of the digital service", and pre-installation. It excludes connectivity, power supply and aftermarket services such as analytics ([FAQ landing page](https://digital-strategy.ec.europa.eu/en/library/commission-publishes-frequently-asked-questions-about-data-act), [FAQ v1.4 PDF](https://ec.europa.eu/newsroom/dae/redirection/document/108144)).

Rouvy's own words:

- "ROUVY turns real-world elevation data into precise resistance on your smart trainer"; its engine "continuously reads gradient data and adjusts your smart trainer in real time"; "Combine ERG intervals with real-world climbs" ([rouvy.com/offer/real-results](https://rouvy.com/offer/real-results)).
- Its privacy policy collects "User Weight (to be able to control the indoor trainer)" ([rouvy.com/privacy-policy](https://rouvy.com/privacy-policy), effective 13 December 2024).

**For:**

- Rouvy reads the trainer's data and sends it resistance commands. That's bidirectional, and it changes the product's behaviour (simulation mode, ERG mode). It is close to the FAQ's thermostat example.
- Art. 2(6) and Recital 17 explicitly include services "subsequently connected … by … a third party", and the "in doubt, apply" rule leans towards coverage.
- Smart trainers are marketed with app compatibility, and riders expect one. A smart trainer without an app runs in its basic fixed or manual mode.

**Against:**

- Rouvy is highly replaceable (Zwift, TrainerRoad, MyWhoosh, the maker's own app), and it isn't pre-installed or sold with the trainer. The FAQ lists both as factors.
- The FAQ concedes that "determining the 'functions' of a connected product is an ongoing and evolving task" and that "practice and courts' interpretation will play an essential role."
- Rouvy could argue it is mainly a content service (route video and augmented reality). Recital 16 excludes content and "data that such sensor-equipped connected products generate when the user … displays or plays content". That argument can exclude the video. It is weak for power, cadence and heart rate, which describe the user's use of the trainer, not the video.

**Reading:** the trainer-control function is the strongest hook. The case is better than "contested" suggests, but no authority or court has ruled on it. I found no legal analysis that addresses fitness or trainer apps specifically.

### Rouvy would be the data holder

The FAQ (Q10 and Q21) says a related-service provider that receives product data under a contract with the user "becomes a data holder". It also says the data holder is whoever "controls access to the readily available data", not whoever made the hardware.

The FAQ (Q28) says establishment outside the EU doesn't matter. Rouvy is in the EU anyway: VirtualTraining s.r.o., Prague-Karlín ([privacy policy](https://rouvy.com/privacy-policy)).

The trainer maker (Wahoo, Garmin and so on) is a separate data holder only for the data it receives itself, usually through its own app.

### The small-enterprise exemption doesn't save Rouvy

Art. 7(1) exempts related services provided by a micro or small enterprise (fewer than 50 staff and no more than €10 M turnover or balance sheet, under Recommendation 2003/361/EC). It only applies where the enterprise has no partner or linked enterprise that is larger.

- The Czech business register puts VirtualTraining s.r.o. (IČO 01898019) in the **50–99 employees** bracket ([podnikatel.cz register entry](https://www.podnikatel.cz/rejstrik/virtualtraining-s-r-o-01898019/)).
- Pale Fire Capital bought a majority stake in 2021 ([e15.cz](https://www.e15.cz/byznys/technologie-a-media/pale-fire-capital-kupuje-tvurce-ceske-aplikace-rouvy-pro-virtualni-jizdu-na-kole-a-beh-1382603)), which probably makes it a linked enterprise.

Either fact is likely enough to rule the exemption out. The headcount is a statistical bracket with no stated date.

## 2. What the rider would get

**Data in scope.** "Readily available" product data and related service data (Art. 2(15)–(17)). Recital 15 and the FAQ table include "raw data and pre-processed data", with metadata such as timestamps. The examples include "position, acceleration, or speed". For a Rouvy ride, that plausibly means:

- the trainer's power, cadence and speed, plus heart rate from a strap;
- the virtual position and gradient Rouvy sent;
- timestamps.

In practice, that's what is already in the Activity file (FIT).

**Out of scope:**

- "information inferred or derived … by means of proprietary, complex algorithms" (Recital 15). That likely covers Rouvy's own training-load figures, FTP estimates, leaderboards and anything else computed beyond simple pre-processing. Whether totals such as normalized power or calories are "derived" is a grey area.
- Content, such as route video (Recital 16; Art. 1(2)(a)).
- Data generated before 12 September 2025. The FAQ says "only data generated/collected after the entry into application of the Data Act should be considered as falling within the scope of Chapter II."

**How it must be delivered.** Art. 4(1) (to the user) and Art. 5(1) (to a third party) both require:

- "without undue delay", "of the same quality as is available to the data holder", "easily, securely, free of charge";
- "in a comprehensive, structured, commonly used and machine-readable format";
- "where relevant and technically feasible, continuously and in real-time";
- for Art. 4, "on the basis of a simple request through electronic means where technically feasible".

The FAQ (Q22a) adds that formats "subject to licensing constraints are not considered 'commonly used'" and gives XML, JSON and CSV as examples. FIT is published under a free licence, so it is probably acceptable. The FAQ also expects "self-service portals" and automation.

**To a third party (Art. 5).** The data holder must make the data available to a third party "upon request by a user, or by a party acting on behalf of a user". Gatekeepers under the Digital Markets Act are excluded (Art. 5(3)). Our server isn't one.

**Contract terms can't override it.** Art. 7(2) says a contract term that "excludes the application of, derogates from or varies the effect of the user's rights under this Chapter shall not be binding." This matters: a ToS can't forbid a rider from asking Rouvy to share with a named service. It does **not** void ToS §7.c, §14.a.vi or §29.h.v as applied to our current method. The Data Act right is to *request* data through the holder, not to access it however one likes.

**Relation to GDPR Art. 20.** Rouvy already offers GDPR portability ([privacy policy](https://rouvy.com/privacy-policy)). The Data Act adds four things:

- it covers non-personal data;
- it gives an explicit continuous and real-time expectation;
- it requires delivery free of charge to a named third party;
- complaints go to a Data Act competent authority, not only the data protection authority.

## 3. Limits that bite on rouvy-mcp

- **No self-help.** Art. 4(11) (user) and Art. 5(5) (third party) say they "shall not use coercive means or abuse gaps in the technical infrastructure of a data holder which is designed to protect the data in order to obtain access to data." The Act doesn't legitimise scraping the private web API.
  - Signing in with the rider's own credentials is not obviously "abusing gaps".
  - Still, the Act can't be cited as authority for the current method.
- **Rouvy picks the mechanism.**
  - The FAQ (Q14 and Q22) leaves direct or indirect access to the data holder's design choice. It could be a download button, a portal or an API.
  - Under Art. 8(1), "in business-to-business relations" the holder must "agree with a data recipient the arrangements" on fair, reasonable and non-discriminatory terms. That means a contract negotiation with Rouvy, not a unilateral switch.
  - The FAQ says a holder offering direct access may still impose contractual conditions, as long as they don't undermine the user's rights.
- **Possible compensation from the third party.**
  - Art. 5(1) makes access free "to the user". Art. 9 lets the holder charge a business data recipient reasonable compensation, which may include a margin.
  - Art. 9(4) caps it at cost for SMEs and not-for-profit research organisations.
  - A free hobby operator might not even be a "data recipient", which Art. 2(14) defines as someone "acting for purposes which are related to that person's trade, business, craft or profession". Where that leaves Art. 8 and Art. 9 for a non-commercial operator is unclear.
- **Third-party duties (Art. 6).** The recipient must:
  - process the data "only for the purposes and under the conditions agreed with the user";
  - erase it when no longer needed;
  - not use it for profiling unless needed for the service;
  - not pass it to gatekeepers;
  - not use it to develop a competing *connected product*. Per the FAQ (Q26), this doesn't extend to competing related services.

  These fit the hosted design already: read-only, no Activity data at rest.
- **GDPR still applies on top** (Art. 5(7) and (13); FAQ Q25a). The operator-risk findings on controller status and Art. 9 health data are unchanged.
- **Trade-secret and safety "handbrakes"** (Arts. 4(2), 4(6)–(8), 5(9)–(11)). They are unlikely to apply to a rider's own power and heart-rate stream, but Rouvy could invoke them against, say, its route-gradient model.
- **Enforcement is immature.**
  - Complaints go to the competent authority where the holder is established (Art. 37; FAQ). Here that's the Czech Republic.
  - A Bird & Bird tracker lists a *proposal* naming the Czech Telecommunications Office (ČTÚ) as data coordinator, alongside the data protection office ÚOOÚ and the Digital and Information Agency ([Bird & Bird Data Act tracker, Czech Republic](https://cm.twobirds.com/en/trending-topics/eu-data-act/data-act-tracker/czech-republic), not fetched: HTTP 403; content from search snippet).
  - Cullen International reported in September 2026 that only six of the 21 member states it surveyed had designated Data Act authorities ([Cullen International](https://www.cullen-international.com/news/2026/09/Competent-authorities-for-EU-data-rules.html), search snippet).
  - I couldn't confirm the Czech implementing act. Without an authority, a refusal leaves only courts or a dispute settlement body that both sides agree to (Art. 10).
- **Design obligations are not yet in force for Rouvy.** The Art. 3(1) "accessible by design" duty applies only to products and related services "placed on the market after 12 September 2026" (Art. 50). Art. 4 and Art. 5 requests have applied since 12 September 2025. Whether Rouvy's ongoing service counts as "placed on the market" after September 2026 is unclear. Art. 3(3) pre-contract information (which data, how to access it and share it with a third party, who the data holder is) applies to new related-service contracts from 12 September 2025. I saw none of that in Rouvy's terms or privacy policy.

## 4. What a request path would look like

1. **Rider, alone (Art. 4).** The rider emails Rouvy (`gdpr@rouvy.com` is the only published data-rights contact; [privacy policy](https://rouvy.com/privacy-policy)). They cite Regulation (EU) 2023/2854 Art. 4(1) and ask for all readily available product and related service data from their rides since 12 September 2025. They ask for it in a machine-readable format, and "continuously" through an API or token. This is a low-cost test of whether Rouvy has a process at all.
2. **Rider names rouvy-mcp (Art. 5).** The rider asks Rouvy to make the data available to the hosted instance, identified by the operator's name and contact. Rouvy must then agree arrangements with the operator (Art. 8). In practice that's a negotiation over a sanctioned access mechanism, such as an OAuth-style grant or a per-rider API key.
3. **Operator to Rouvy.** Combine step 2 with the "written permission" ask from [Operator risk for a public instance: Rouvy ToS, GDPR, official integrations](https://github.com/scastiel/rouvymcp/issues/29). Present it as offering to be the compliant channel for the Art. 5 requests Rouvy must honour anyway. This works better than asking for a favour.
4. **If Rouvy refuses or ignores it.** Complain to the Czech competent authority once one is designated (Art. 37(5)(b)), or go to court or an agreed dispute settlement body. That route is slow and uncertain, and it isn't something a hobby project should plan around.

## 5. Effect on the M2 route

- **Data path: no change.** Nothing in the Act gives us a technical channel today, and Rouvy has published no Data Act mechanism. The hosted server keeps signing in on the rider's behalf.
- **Risk posture: unchanged, with an argument added.** The Act doesn't legalise the ToS-breaching sign-in-data path, so the operator-risk amber verdict stands. It does make a refusal by Rouvy *to provide any sanctioned path* harder to defend, at least for EU riders on EU-sold trainers. That gives the permission request leverage.
- **Suggested spec touches:**
  - mention the Data Act in the permission request to Rouvy;
  - give riders an optional "ask Rouvy under the Data Act" template in the self-host and README docs;
  - align the hosted server's processing promises with the Art. 6 third-party duties (purpose-limited, no profiling, no onward sharing, erase when done) so the server is ready if Rouvy ever offers an Art. 5 channel.

## Open questions

- Does Rouvy have an internal Data Act process? One real Art. 4 request from the maintainer's own account would answer this cheaply and show what format and latency Rouvy offers.
- Is a free, non-commercial operator a "data recipient" (Art. 2(14))? This decides whether Art. 8 and Art. 9 apply, including fair, reasonable and non-discriminatory terms and compensation, and how a hobby instance fits.
- Will Czech enforcement exist? Is the ČTÚ designation enacted?
- Would a trainer maker's own data path be a cleaner Data Act route? A Garmin or Wahoo request could cover the same power and heart-rate stream when their app records it. It doesn't help when only Rouvy is connected.
