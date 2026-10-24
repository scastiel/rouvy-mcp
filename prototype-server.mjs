// PROTOTYPE, throwaway. Answers one question for the Rouvy MCP map:
// "What MCP tools does M1 expose, and in what shape does per-second data reach the model?"
// It is offline: Activities come from ./prototype-data (list.json, detail-<id>.json, <id>.fit),
// captured from the author's own account and never committed.
//
// Run: VARIANT=A|B|C|all node prototype-server.mjs   (stdio MCP server)
//   A  streams   get_activity_streams: downsampled columns, adjustable resolution/window
//   B  analysis  get_activity_intervals + get_window_stats: server-side maths, no raw rows
//   C  file      export_activity_data: CSV on disk + MCP resource, model analyses it itself
//   all          every tool, to see which the model reaches for
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import FitParser from 'fit-file-parser';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.ROUVY_PROTO_DATA ?? path.join(HERE, 'prototype-data');
const OUT = process.env.ROUVY_PROTO_OUT ?? path.join(HERE, 'prototype-out');
const VARIANT = (process.env.VARIANT ?? 'all').toUpperCase();
const has = (v) => VARIANT === 'ALL' || VARIANT === v;

const list = JSON.parse(fs.readFileSync(path.join(DATA, 'list.json'), 'utf8'))[
  'routes/resources.activities-pagination'
].data.activities;
const FTP = Number(process.env.FTP ?? 195);
// Rouvy's own power zone thresholds, % of FTP (userData.zoneValues in the detail payload)
const ZONE_PCT = [55, 75, 90, 105, 120, 150];
const ZONE_NAMES = ['Z1 recovery', 'Z2 endurance', 'Z3 tempo', 'Z4 threshold', 'Z5 VO2max', 'Z6 anaerobic', 'Z7 neuromuscular'];
const FIELDS = ['power', 'heart_rate', 'cadence', 'speed_kmh', 'altitude', 'distance_m'];

// ---------- data ----------
const cache = new Map();
async function load(id) {
  if (cache.has(id)) return cache.get(id);
  const item = list.find((a) => a.id === id);
  if (!item) throw new Error(`Unknown Activity id ${id}. Call list_activities first.`);
  const buf = fs.readFileSync(path.join(DATA, `${id}.fit`));
  const fit = await new Promise((res, rej) =>
    new FitParser({ mode: 'list', speedUnit: 'km/h', lengthUnit: 'm', force: true }).parse(buf, (e, d) => (e ? rej(e) : res(d))),
  );
  const t0 = new Date(fit.records[0].timestamp).getTime();
  const n = Math.round((new Date(fit.records.at(-1).timestamp).getTime() - t0) / 1000) + 1;
  const s = Object.fromEntries(FIELDS.map((f) => [f, new Array(n).fill(null)]));
  for (const r of fit.records) {
    const i = Math.round((new Date(r.timestamp).getTime() - t0) / 1000);
    s.power[i] = r.power ?? null;
    s.heart_rate[i] = r.heart_rate ?? null;
    s.cadence[i] = r.cadence ?? null;
    s.speed_kmh[i] = r.speed ?? null;
    s.altitude[i] = r.altitude ?? null;
    s.distance_m[i] = r.distance ?? null;
  }
  const detailPath = path.join(DATA, `detail-${id}.json`);
  const detail = fs.existsSync(detailPath) ? JSON.parse(fs.readFileSync(detailPath, 'utf8')) : null;
  const a = { item, s, n, laps: fit.laps ?? [], detail };
  cache.set(id, a);
  return a;
}

// ---------- maths ----------
const r1 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10) / 10);
const vals = (arr, a = 0, b = arr.length) => arr.slice(a, b).filter((v) => v != null);
const mean = (xs) => (xs.length ? xs.reduce((p, c) => p + c, 0) / xs.length : null);
const max = (xs) => (xs.length ? Math.max(...xs) : null);
function rolling(arr, w) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i] ?? 0;
    if (i >= w) sum -= arr[i - w] ?? 0;
    if (i >= w - 1) out.push(sum / w);
  }
  return out;
}
const np = (p) => {
  const r = rolling(p, 30);
  return r.length ? Math.pow(mean(r.map((x) => x ** 4)), 0.25) : null;
};
const peak = (p, w) => (p.length >= w ? Math.round(Math.max(...rolling(p, w))) : null);
const zoneOf = (w) => {
  const pct = (w / FTP) * 100;
  const i = ZONE_PCT.findIndex((z) => pct < z);
  return i === -1 ? 6 : i;
};
const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

function windowStats(s, a, b) {
  const p = s.power.slice(a, b).map((v) => v ?? 0);
  const hr = vals(s.heart_rate, a, b);
  const alt = vals(s.altitude, a, b);
  let gain = 0;
  for (let i = 1; i < alt.length; i++) if (alt[i] > alt[i - 1]) gain += alt[i] - alt[i - 1];
  const d = vals(s.distance_m, a, b);
  return {
    start: fmt(a),
    end: fmt(b),
    duration: fmt(b - a),
    avg_power: r1(mean(p)),
    np: r1(np(p)),
    max_power: max(p),
    pct_ftp: r1((mean(p) / FTP) * 100),
    avg_hr: r1(mean(hr)),
    max_hr: max(hr),
    avg_cadence: r1(mean(vals(s.cadence, a, b).filter((c) => c > 0))),
    avg_speed_kmh: r1(mean(vals(s.speed_kmh, a, b))),
    distance_km: d.length ? r1((d.at(-1) - d[0]) / 1000) : null,
    elevation_gain_m: Math.round(gain),
  };
}

async function summary(id) {
  const { item, s, n, laps, detail } = await load(id);
  const p = s.power.map((v) => v ?? 0);
  const zones = new Array(7).fill(0);
  for (const w of rolling(p, 1)) zones[zoneOf(w)]++;
  const out = {
    id,
    title: item.title,
    type: item.training,
    start_utc: item.startUTC,
    rouvy: { tss: item.total.tss, if: item.total.if, kcal: item.total.kCal, training_score: item.trainingScore },
    ...windowStats(s, 0, n),
    ftp_used: FTP,
    power_peaks_w: Object.fromEntries(
      [['5s', 5], ['30s', 30], ['1min', 60], ['5min', 300], ['20min', 1200], ['60min', 3600]].map(([k, w]) => [k, peak(p, w)]),
    ),
    time_in_power_zones: Object.fromEntries(ZONE_NAMES.map((z, i) => [z, `${Math.round((zones[i] / n) * 100)}%`])),
    laps: laps.length,
    samples: { count: n, rate_hz: 1, fields: FIELDS.filter((f) => s[f].some((v) => v != null)) },
  };
  if (detail?.segmentsPasses?.length) {
    const segs = detail.route?.segments ?? [];
    out.route_segments = detail.segmentsPasses.map((sp) => {
      const seg = segs.find((x) => x.id === sp.id);
      return {
        name: seg?.name ?? sp.id,
        type: seg?.type,
        elapsed: fmt(sp.elapsedTimeSeconds),
        avg_power: sp.avgPowerWatts,
        avg_hr: sp.avgHeartRateBPM,
        avg_speed_kmh: r1(sp.avgSpeedMetersPerSecond * 3.6),
      };
    });
  }
  return out;
}

function autoIntervals(s, n, minLen) {
  const sm = rolling(s.power.map((v) => v ?? 0), 30);
  const z = [...new Array(29).fill(zoneOf(sm[0] ?? 0)), ...sm.map(zoneOf)];
  let segs = [];
  for (let i = 0; i < n; i++) {
    const last = segs.at(-1);
    if (last && last.zone === z[i]) last.b = i + 1;
    else segs.push({ a: i, b: i + 1, zone: z[i] });
  }
  // fold short blips into their neighbour, then merge equal neighbours
  for (let changed = true; changed; ) {
    changed = false;
    const out = [];
    for (const sg of segs) {
      const last = out.at(-1);
      if (last && (sg.b - sg.a < minLen || last.zone === sg.zone)) {
        last.b = sg.b;
        changed = true;
      } else out.push({ ...sg });
    }
    segs = out;
  }
  return segs;
}

// ---------- server ----------
const server = new McpServer({ name: 'rouvy-prototype', version: '0.0.0' });
const json = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }] });
const idArg = { activity_id: z.string().describe('Activity id from list_activities') };

server.registerTool(
  'list_activities',
  {
    description: 'List your Rouvy Activities (completed rides), newest first.',
    inputSchema: { limit: z.number().int().min(1).max(50).default(10), offset: z.number().int().min(0).default(0) },
  },
  async ({ limit, offset }) =>
    json(
      list.slice(offset, offset + limit).map((a) => ({
        id: a.id,
        title: a.title,
        type: a.training,
        start_utc: a.startUTC,
        moving_time: fmt(a.total.movingTimeSec),
        distance_km: r1(a.total.distM / 1000),
        elevation_m: a.total.elevM,
        tss: a.total.tss,
        if: a.total.if,
      })),
    ),
);

server.registerTool(
  'get_activity',
  {
    description:
      'Summary of one Activity: totals, averages, normalized power, power peaks, time in power zones, route segment results.',
    inputSchema: idArg,
  },
  async ({ activity_id }) => json(await summary(activity_id)),
);

if (has('A'))
  server.registerTool(
    'get_activity_streams',
    {
      description:
        'Per-second data of one Activity, downsampled by averaging into buckets of resolution_sec. Columnar: t (seconds from start) plus one array per field. Optionally restrict to a time window. Max 2000 points per field.',
      inputSchema: {
        ...idArg,
        fields: z.array(z.enum(FIELDS)).default(['power', 'heart_rate', 'cadence']),
        resolution_sec: z.number().int().min(1).default(30),
        start_sec: z.number().int().min(0).optional(),
        end_sec: z.number().int().min(1).optional(),
      },
    },
    async ({ activity_id, fields, resolution_sec, start_sec = 0, end_sec }) => {
      const { s, n } = await load(activity_id);
      const b = Math.min(end_sec ?? n, n);
      const res = Math.max(resolution_sec, Math.ceil((b - start_sec) / 2000));
      const out = { resolution_sec: res, t: [] };
      for (const f of fields) out[f] = [];
      for (let i = start_sec; i < b; i += res) {
        out.t.push(i);
        for (const f of fields) out[f].push(r1(mean(vals(s[f], i, Math.min(i + res, b)))));
      }
      return json(out);
    },
  );

if (has('B')) {
  server.registerTool(
    'get_activity_intervals',
    {
      description:
        'Split one Activity into intervals and return stats per interval (power, NP, %FTP, HR, cadence, speed, distance, climbing). split="auto" detects efforts from 30s-smoothed power zones; split="fixed" cuts every every_sec seconds.',
      inputSchema: {
        ...idArg,
        split: z.enum(['auto', 'fixed']).default('auto'),
        every_sec: z.number().int().min(10).default(300),
        min_interval_sec: z.number().int().min(10).default(60).describe('auto only: shorter blips merge into neighbours'),
      },
    },
    async ({ activity_id, split, every_sec, min_interval_sec }) => {
      const { s, n } = await load(activity_id);
      const segs =
        split === 'fixed'
          ? Array.from({ length: Math.ceil(n / every_sec) }, (_, i) => ({ a: i * every_sec, b: Math.min((i + 1) * every_sec, n) }))
          : autoIntervals(s, n, min_interval_sec);
      return json(segs.map((sg) => ({ ...(sg.zone != null ? { zone: ZONE_NAMES[sg.zone] } : {}), ...windowStats(s, sg.a, sg.b) })));
    },
  );
  server.registerTool(
    'get_window_stats',
    {
      description:
        'Stats for any time window of one Activity (seconds from start), plus best efforts inside it. Use to compare halves, zoom on a climb, or measure drift.',
      inputSchema: { ...idArg, start_sec: z.number().int().min(0), end_sec: z.number().int().min(1) },
    },
    async ({ activity_id, start_sec, end_sec }) => {
      const { s, n } = await load(activity_id);
      const b = Math.min(end_sec, n);
      const p = s.power.slice(start_sec, b).map((v) => v ?? 0);
      return json({
        ...windowStats(s, start_sec, b),
        power_peaks_w: Object.fromEntries([['5s', 5], ['1min', 60], ['5min', 300], ['20min', 1200]].map(([k, w]) => [k, peak(p, w)])),
      });
    },
  );
}

async function toCsv(id) {
  const { s, n, item } = await load(id);
  const t0 = new Date(item.startUTC).getTime();
  const rows = ['t_sec,timestamp_utc,' + FIELDS.join(',')];
  for (let i = 0; i < n; i++) rows.push([i, new Date(t0 + i * 1000).toISOString(), ...FIELDS.map((f) => s[f][i] ?? '')].join(','));
  return { csv: rows.join('\n'), n };
}

if (has('C')) {
  server.registerTool(
    'export_activity_data',
    {
      description:
        'Write the full per-second data of one Activity to a local file and return its path, columns and a preview. format=csv (1 row per second) or fit (the original Rouvy Activity file). Analyse the file with your own code tools. Also readable as resource rouvy://activity/{id}/records.csv.',
      inputSchema: { ...idArg, format: z.enum(['csv', 'fit']).default('csv') },
    },
    async ({ activity_id, format }) => {
      fs.mkdirSync(OUT, { recursive: true });
      if (format === 'fit') {
        const p = path.join(OUT, `${activity_id}.fit`);
        fs.copyFileSync(path.join(DATA, `${activity_id}.fit`), p);
        return json({ path: p, format: 'fit', bytes: fs.statSync(p).size });
      }
      const { csv, n } = await toCsv(activity_id);
      const p = path.join(OUT, `${activity_id}.csv`);
      fs.writeFileSync(p, csv);
      const lines = csv.split('\n');
      return json({ path: p, format: 'csv', rows: n, columns: lines[0].split(','), preview: lines.slice(1, 4), resource: `rouvy://activity/${activity_id}/records.csv` });
    },
  );
  server.registerResource(
    'activity-records',
    new ResourceTemplate('rouvy://activity/{id}/records.csv', {
      list: async () => ({ resources: list.map((a) => ({ uri: `rouvy://activity/${a.id}/records.csv`, name: `${a.title} (${a.startUTC.slice(0, 10)})`, mimeType: 'text/csv' })) }),
    }),
    { description: 'Per-second records of one Activity as CSV', mimeType: 'text/csv' },
    async (uri, { id }) => ({ contents: [{ uri: uri.href, mimeType: 'text/csv', text: (await toCsv(id)).csv }] }),
  );
}

await server.connect(new StdioServerTransport());
