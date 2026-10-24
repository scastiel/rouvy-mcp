import fs from 'node:fs';
const dir = new URL('.', import.meta.url).pathname;
const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort();
const rows = [];
for (const f of files) {
  const lines = fs.readFileSync(dir + f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const calls = []; const sizes = {};
  for (const m of lines) {
    for (const c of m.message?.content ?? []) {
      if (c.type === 'tool_use') calls.push({ id: c.id, name: c.name.replace('mcp__rouvy__', ''), input: c.input });
      if (c.type === 'tool_result') sizes[c.tool_use_id] = JSON.stringify(c.content).length;
    }
  }
  const res = lines.find(m => m.type === 'result');
  const u = res?.usage ?? {};
  rows.push({ f: f.replace('.jsonl', ''), turns: res?.num_turns, cost: res?.total_cost_usd?.toFixed(3), in_tok: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), sub: res?.subtype,
    calls: calls.map(c => `${c.name}(${JSON.stringify(c.input).replace(/"activity_id":"[^"]+",?/, '').slice(0, 90)}) ->${sizes[c.id] ?? '?'}ch`), answer: res?.result });
}
const mode = process.argv[2] ?? 'table';
for (const r of rows) {
  console.log(`\n### ${r.f}  turns=${r.turns} cost=$${r.cost} input_tokens=${r.in_tok} ${r.sub}`);
  for (const c of r.calls) console.log('  - ' + c);
  if (mode === 'answers') console.log('  ANSWER: ' + (r.answer ?? '').replace(/\n+/g, ' ').slice(0, 1400));
}
