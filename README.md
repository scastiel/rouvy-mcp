# PROTOTYPE, throwaway: Rouvy MCP tool surface

Answers [MCP tool surface and raw-data shape](https://github.com/scastiel/rouvymcp/issues/7). This isn't production code and is never merged.

A stdio MCP server with switchable tool sets, running offline on Activities captured from the author's account. That data (`prototype-data/`: `list.json`, `detail-<id>.json`, `<id>.fit`) isn't committed.

| `VARIANT` | Tools |
|---|---|
| `A` streams | `list_activities`, `get_activity`, `get_activity_streams` (downsampled columns, resolution and window) |
| `B` analysis | `list_activities`, `get_activity`, `get_activity_intervals` (auto/fixed), `get_window_stats` |
| `C` file | `list_activities`, `get_activity`, `export_activity_data` (CSV/FIT to disk) + resource `rouvy://activity/{id}/records.csv` |
| `all` | everything |

```sh
npm install
claude mcp add rouvy-proto -e VARIANT=all -e ROUVY_PROTO_DATA=/path/to/prototype-data -- node "$PWD/prototype-server.mjs"
```

`runs/` holds the headless test drive: `run.sh` (3 questions × 4 variants with `claude -p --model sonnet`), `analyze.mjs`, and `findings-calls.txt` (tool calls, result sizes, tokens and cost per run; answers and Activity ids left out).
