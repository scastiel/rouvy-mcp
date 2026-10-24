# Parsing Rouvy Activity files in TypeScript

Research for [#4](https://github.com/scastiel/rouvymcp/issues/4) (map: [#1](https://github.com/scastiel/rouvymcp/issues/1)).
Researched 2026-10-24.

**Question:** which TypeScript/Node library should parse Rouvy's Activity files (most
likely FIT) into per-second streams (power, cadence, heart rate, speed, distance,
altitude) and session/lap summaries?

## Recommendation

**Use [`fit-file-parser`](https://www.npmjs.com/package/fit-file-parser) (MIT).**
**Runner-up: Garmin's official [`@garmin/fitsdk`](https://www.npmjs.com/package/@garmin/fitsdk).**

Put the parser behind our own small `parseActivityFile(bytes) -> { records, laps, session }`
module, with our own camelCase types. Swapping libraries later then touches one file.

Why `fit-file-parser` wins:

1. **License.** It is MIT ([LICENSE][ffp-license]). Garmin's SDK uses the proprietary
   *FIT Protocol License*, not an OSI license ([LICENSE.txt][garmin-license]). That
   license grants a "non-exclusive, … non-transferable, non-sublicensable, limited license
   to use the Licensed Technology for Licensee's **internal business purposes**" (§1). It
   forbids anyone to "distribute, publish, transfer or otherwise make available the
   Licensed Technology … to any third party" (§2c), or to distribute it "so that any part of it becomes
   subject to any license that requires that the Licensed Technology … be disclosed or
   distributed in source code form" (§2d). It also calls the SDK Garmin's "Confidential
   Information" (§4). Declaring it as a normal npm dependency probably does not
   redistribute it. Still, it is a poor fit for an MIT/Apache project, and it rules out shipping a
   bundled single-file build or vendoring it.
2. **Compressed-timestamp headers.** Garmin's JS decoder **throws** on them:
   `#decodeCompressedTimestampDataMessage() { this.#throwError("compressed timestamp
   messages are not currently supported"); }` ([src/decoder.js][garmin-decoder], lines
   413-414 in 21.218.0). `fit-file-parser` decodes them, including the 5-bit rollover
   (`dist/binary.js`, lines 697-700 in 6.2.3). We do not yet know whether Rouvy's files
   use compressed timestamps. With Garmin's SDK, a file that does would fail completely.
3. **Packaging.** It ships dual ESM + CJS with an `exports` map and `.d.ts` for each entry
   point, and states support for "Node.js 20 or newer" ([README][ffp-readme]). Its only
   runtime dependency is `buffer@^6`. Garmin's SDK is ESM-only: `"type": "module"`,
   `main: src/index.js`, no `exports` and no `engines`. That works for us, but it is less flexible.
4. **Maintenance.** It is very active: 39 npm releases in the last 12 months, latest 6.2.3
   on 2026-10-20, a detailed [CHANGELOG][ffp-changelog] and 1 open issue (a 2020 feature
   request). The GitHub repo is `jimmykane/fit-parser`. It was originally Pierre
   Jacquier's `fit-file-parser` and is used by `@sports-alliance/sports-lib`. Garmin's SDK is also
   maintained (13 releases in 12 months, latest 21.218.0 on 2026-10-06), but GitHub
   issues are **disabled** (`has_issues: false`). Support goes through the Garmin developer forum.

Why Garmin's SDK is still the runner-up: it is the reference implementation. It is
auto-generated from the official FIT profile, has precise camelCase typings for every
message (`RecordMesg`, `SessionMesg`, `LapMesg`, … in `src/types/mesgs.d.ts`), keeps
developer fields separate from native fields, and has a `mesgListener` streaming hook. If
the license question is settled (for example, Garmin confirms that npm-dependency use is
fine) and Rouvy's files contain no compressed timestamps, it is a sound alternative.

## Candidates compared

npm and GitHub data as of 2026-10-24. Sources: `npm view`,
`api.npmjs.org/downloads/point/last-week`, `gh api repos/...`.

| Package | Version / last publish | Weekly DLs | License | Types | Module format | Runtime deps | Verdict |
|---|---|---|---|---|---|---|---|
| **fit-file-parser** ([repo][ffp-repo]) | 6.2.3 / 2026-10-20 | ~22.7k | MIT | Bundled `.d.ts`, `ParsedFit`/`ParsedRecord` etc., snake_case | ESM + CJS (`exports` map); Node ≥ 20 | `buffer` | **Recommended** |
| **@garmin/fitsdk** ([repo][garmin-repo]) | 21.218.0 / 2026-10-06 | ~33.7k | Garmin FIT Protocol License (proprietary) | Bundled `.d.ts`, full profile, camelCase | ESM only | none | **Runner-up** |
| @garmin-fit/sdk | 21.115.0 / 2023-09-19 | – | same Garmin license | – | ESM | none | Old name of the Garmin package, abandoned |
| @sports-alliance/sports-lib | 23.7.1 / 2026-10-24 | ~3.4k | **AGPL-3.0** | yes | ESM + CJS | wraps `fit-file-parser`, `fast-xml-parser`, … | Rejected: copyleft and heavy; it is a whole activity-analysis library |
| fit-parser (duereg) | 0.10.1 / 2022 | ~84 | MIT | no | CJS | lodash, moment | Rejected: unmaintained |
| easy-fit | 0.0.8 / 2022 | ~375 | MIT | no | CJS | none | Rejected: unmaintained (ancestor of fit-file-parser) |
| fit-decoder | 1.0.5 / 2022 | ~100 | MIT | no | CJS | none | Rejected: unmaintained |

Unpacked size is about 1.5 MB for both front-runners. Most of it is the generated FIT
profile tables. It does not matter for a local Node server.

## Hands-on check

Both libraries were installed in a scratch dir (Node v22.22.0) and run on two public
sample files:

- `Activity.fit` from Garmin's own test data ([test/data][garmin-testdata]): 3601
  records at 1 Hz with power, cadence, HR, speed, distance, altitude and 2 developer
  fields.
- `running-with-developer-data.fit` from fit-file-parser's tests: 1681 records and 8
  developer fields (Stryd: "Power", "Cadence", "Form Power", …).

Results:

- Both decoded every record and the session/lap/activity messages without errors, in
  about 15-20 ms each. `Decoder.checkIntegrity()` returned `true` for both files.
- **Garmin output**: `messages.recordMesgs[i]` holds `{ timestamp: Date, power,
  cadence, heartRate, speed, distance, altitude, enhancedSpeed, enhancedAltitude,
  positionLat/positionLong (raw semicircles), developerFields: { 0: 287, 1: 84, … } }`.
  Developer values are keyed by field-definition number and are resolved with
  `messages.fieldDescriptionMesgs`. Units are SI (m, m/s).
- **fit-file-parser output** (`mode: 'list'`): `records[i]` holds `{ timestamp: Date,
  power, cadence, heart_rate, speed, distance, altitude, position_lat/long (degrees),
  elapsed_time, timer_time, …, "Power": 287, "Form Power": 79, … }`. Defaults are SI;
  `speedUnit`/`lengthUnit` convert units. `elapsedRecordField: true` adds
  `elapsed_time`/`timer_time`, which is handy for per-second streams.

Minimal usage:

```ts
import FitParser from 'fit-file-parser';
const fit = await new FitParser({ mode: 'list', elapsedRecordField: true }).parseAsync(bytes);
fit.records; fit.laps; fit.sessions; fit.field_descriptions;
```

```ts
import { Decoder, Stream } from '@garmin/fitsdk';
const { messages, errors } = new Decoder(Stream.fromBuffer(bytes)).read();
messages.recordMesgs; messages.lapMesgs; messages.sessionMesgs;
```

## Caveats with fit-file-parser (to handle in our wrapper)

- **Developer fields are merged into the record by display name.** In the sample,
  `"Power"` sits next to native `power`, and `"Heart Rate"` next to `heart_rate`. A
  developer field whose name equals a native snake_case key could overwrite it. If Rouvy
  writes developer fields, use `includeRawDeveloperFields: true`. It adds a lossless
  `raw_developer_fields` view keyed by `developer_data_index` and `field_definition_number`
  ([README "Lossless developer fields"][ffp-readme]). Read native fields by their known
  keys only.
- **`force` defaults to `true`.** By default the parser skips CRC checks and recovers
  what it can. For our purposes (a user's own download) that is the right default. Use
  `{ force: false }` in tests and fixtures to catch corruption.
- **Output shape quirks.** Some fields come back as objects. For example, the session's
  `message_index` is `{ value, reserved, selected }`, and array fields contain `null`s.
  Map only the fields we need into our own types; do not pass the raw object through to
  MCP clients.
- **Concatenated files.** If Rouvy ever appends several FIT files, `parseAsync` reads
  the first one. `parseFilesAsync()` (added in 6.2.0) returns all of them.

## TCX / GPX (only if recon shows Rouvy exports them)

- [`@tmcw/togeojson`][togeojson] 7.1.3: BSD-2-Clause, ~271k weekly downloads, typed, ESM
  + CJS. It converts TCX and GPX to GeoJSON, including heart rate and TCX `Watts`
  extensions in `coordinateProperties`, and lap stats (`avgHeartRate`, `avgWatts`, …).
  In Node it needs a DOM, and the README recommends `@xmldom/xmldom` (MIT, 0.9.12).
  It is the clear choice if non-FIT formats appear.
- `tcx-js` (2022, xml2js) and `gpxparser` (2022, pulls in jsdom 15) are unmaintained.
  Skip them.

## Open questions surfaced

- **Does Rouvy's Activity file use compressed-timestamp headers or developer fields?**
  Recon ([#5][recon]) should save one real (redacted) Activity file as a fixture and
  run both parsers on it. This would confirm the choice, and is the only thing that could
  revive Garmin's SDK as the first choice.
- **Is the download really FIT?** Is it served raw or zipped/gzipped? If compressed, we
  need a decompression step before the parser; Node's built-in `zlib` covers gzip, but a
  zip archive needs a library.

[ffp-repo]: https://github.com/jimmykane/fit-parser
[ffp-license]: https://github.com/jimmykane/fit-parser/blob/main/LICENSE
[ffp-readme]: https://github.com/jimmykane/fit-parser/blob/main/README.md
[ffp-changelog]: https://github.com/jimmykane/fit-parser/blob/main/CHANGELOG.md
[garmin-repo]: https://github.com/garmin/fit-javascript-sdk
[garmin-license]: https://github.com/garmin/fit-javascript-sdk/blob/main/LICENSE.txt
[garmin-decoder]: https://github.com/garmin/fit-javascript-sdk/blob/main/src/decoder.js
[garmin-testdata]: https://github.com/garmin/fit-javascript-sdk/tree/main/test/data
[togeojson]: https://github.com/placemark/togeojson
[map]: https://github.com/scastiel/rouvymcp/issues/1
[recon]: https://github.com/scastiel/rouvymcp/issues/5
