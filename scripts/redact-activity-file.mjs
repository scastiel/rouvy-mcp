// Turns a raw Activity file (FIT, as downloaded from the export URL) into a committable fixture:
// rewrite fields in place (shift every timestamp, set every position to FIT's invalid value,
// blank sensor serial numbers and names), then fix the CRCs. No FIT encoder: the file keeps its
// exact layout, so the data size doesn't change.
//
//   node scripts/redact-activity-file.mjs <raw .fit> test/fixtures/activity-<name>.fit [start ISO]
//
// Pass the matching detail fixture's `startUTC` as the start so the two line up; without it, the
// shift is random. Never commit the raw file.
import { randomInt } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const [input, output, start] = process.argv.slice(2);
if (!input || !output) throw new Error("usage: redact-activity-file.mjs <raw> <fixture> [start ISO]");

// FIT counts seconds from 1989-12-31T00:00:00Z.
const FIT_EPOCH_SEC = 631_065_600;
const INVALID_UINT32 = 0xffffffff;
const INVALID_SINT32 = 0x7fffffff;

const RECORD = 20;
const SESSION = 18;
const LAP = 19;
const ACTIVITY = 34;
const DEVICE_INFO = 23;

/** date_time fields, by global message number. Field 253 is the timestamp of every message. */
const TIME_FIELDS = { [SESSION]: [2], [LAP]: [2] };
/** The activity's local time: it gives away the rider's UTC offset, so it's set to invalid. */
const LOCAL_TIMESTAMP = 5;
/** Latitude/longitude fields (semicircles), by global message number. */
const POSITION_FIELDS = {
  [RECORD]: [0, 1],
  [LAP]: [3, 4, 5, 6, 27, 28, 29, 30],
  [SESSION]: [3, 4, 29, 30, 31, 32, 38, 39, 40, 41],
};
/** Fields that name the rider's own sensors: serial number (uint32z, invalid 0) and product name. */
const SENSOR_FIELDS = { serial: 3, productName: 27 };

const bytes = new Uint8Array(await readFile(input));
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const headerSize = bytes[0];
const dataSize = view.getUint32(4, true);
if (String.fromCharCode(...bytes.subarray(8, 12)) !== ".FIT") throw new Error("not a FIT file");
const end = headerSize + dataSize;

let shiftSec;
const definitions = new Map();
let offset = headerSize;
let records = 0;
while (offset < end) {
  const header = bytes[offset++];
  if (header & 0x80) throw new Error("compressed timestamps: not seen in Rouvy's files, not handled");
  const local = header & 0x0f;
  if (header & 0x40) {
    const littleEndian = bytes[offset + 1] === 0;
    const global = view.getUint16(offset + 2, littleEndian);
    const count = bytes[offset + 4];
    offset += 5;
    const fields = [];
    for (let i = 0; i < count; i++, offset += 3) fields.push({ num: bytes[offset], size: bytes[offset + 1] });
    let developerSize = 0;
    if (header & 0x20) {
      const developerCount = bytes[offset++];
      for (let i = 0; i < developerCount; i++, offset += 3) developerSize += bytes[offset + 1];
    }
    definitions.set(local, { littleEndian, global, fields, developerSize });
    continue;
  }
  const definition = definitions.get(local);
  if (!definition) throw new Error(`data message before its definition at byte ${offset - 1}`);
  const { littleEndian, global, fields } = definition;
  if (global === RECORD) records++;
  for (const field of fields) {
    const at = offset;
    offset += field.size;
    if (global === ACTIVITY && field.num === LOCAL_TIMESTAMP) {
      view.setUint32(at, INVALID_UINT32, littleEndian);
    } else if (field.num === 253 || TIME_FIELDS[global]?.includes(field.num)) {
      const value = view.getUint32(at, littleEndian);
      if (value === INVALID_UINT32) continue;
      shiftSec ??= start ? Math.round(Date.parse(start) / 1000) - FIT_EPOCH_SEC - value : -randomInt(60 * 86_400, 180 * 86_400);
      view.setUint32(at, value + shiftSec, littleEndian);
    } else if (POSITION_FIELDS[global]?.includes(field.num) && field.size === 4) {
      view.setInt32(at, INVALID_SINT32, littleEndian);
    } else if (global === DEVICE_INFO && field.num === SENSOR_FIELDS.serial) {
      bytes.fill(0, at, at + field.size);
    } else if (global === DEVICE_INFO && field.num === SENSOR_FIELDS.productName) {
      bytes.fill(0, at, at + field.size);
    }
  }
  offset += definition.developerSize;
}

if (headerSize >= 14) view.setUint16(12, crc(bytes.subarray(0, 12)), true);
view.setUint16(end, crc(bytes.subarray(0, end)), true);
await writeFile(output, bytes.subarray(0, end + 2));
console.log(`${records} records redacted into ${output}`);

/** FIT's CRC-16, as in the FIT SDK. */
function crc(data) {
  const table = [0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400];
  let sum = 0;
  for (const byte of data) {
    let tmp = table[sum & 0xf];
    sum = (sum >> 4) & 0x0fff;
    sum = sum ^ tmp ^ table[byte & 0xf];
    tmp = table[sum & 0xf];
    sum = (sum >> 4) & 0x0fff;
    sum = sum ^ tmp ^ table[(byte >> 4) & 0xf];
  }
  return sum;
}
