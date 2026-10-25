# rouvy-mcp

Unofficial Rouvy MCP server.

It reads your own [Rouvy](https://rouvy.com) Activities and serves them to any MCP client (Claude Desktop, Claude Code, Cursor…): list your Activities, read Rouvy's summary of one, and analyse its per-second data (splits, any stretch you pick, downsampled streams). Read-only, local and stdio only, or [self-hosted on Cloudflare](#self-host-on-cloudflare) for web clients such as claude.ai. Please read the [disclaimer](#disclaimer) before you use it.

## Install

You need Node.js 22 or later.

**1. Log in once**, in a terminal:

```sh
npx -y rouvy-mcp login
```

It asks for your Rouvy email and password (a Rouvy password: Google, Apple or Facebook sign-in alone won't do, but you can set a password on your Rouvy account). The password is never stored. Only a refresh token is kept, in `$XDG_CONFIG_HOME/rouvy-mcp/credentials.json` (by default `~/.config/rouvy-mcp/credentials.json`; `%APPDATA%\rouvy-mcp\credentials.json` on Windows), readable by you alone.

**2. Add the server to your MCP client.** For most clients, that's this entry in the MCP config:

```json
{
  "mcpServers": {
    "rouvy": {
      "command": "npx",
      "args": ["-y", "rouvy-mcp@latest"]
    }
  }
}
```

`@latest` keeps npx from serving an old cached version, so you get the fixes when Rouvy changes something. With Claude Code: `claude mcp add rouvy -- npx -y rouvy-mcp@latest`.

If you log in after the client has started, there's no need to restart it: the server reads the credentials file on every call.

### Optional: exporting files

Set `ROUVY_MCP_EXPORT_DIR` to an absolute folder path to turn on the `export_activity_file` tool, which saves an Activity's FIT file, or its per-second records as CSV, into that folder:

```json
{
  "mcpServers": {
    "rouvy": {
      "command": "npx",
      "args": ["-y", "rouvy-mcp@latest"],
      "env": { "ROUVY_MCP_EXPORT_DIR": "/Users/you/Rouvy exports" }
    }
  }
}
```

Without it, the tool doesn't exist and rouvy-mcp writes nothing to disk besides the credentials file.

## Tools

| Tool | What it gives |
|---|---|
| `list_activities` | Your Activities, newest first: id, title, type, start, moving time, distance, elevation, TSS, IF. |
| `get_activity` | One Activity's summary with Rouvy's own numbers (NP, IF, TSS, power peaks, HR, zones, laps…) and its Activity snapshot (the Rider settings Rouvy stored with it). |
| `get_activity_intervals` | Fixed-size splits (every 5 min by default) from the per-second Activity file. |
| `get_window_stats` | Stats for one stretch (e.g. a climb from 20:00 to 35:00): best efforts, first half vs second half, HR:power decoupling. |
| `get_activity_streams` | Downsampled per-second data (power, heart rate, cadence, speed, altitude, distance), at most 500 points per field. |
| `export_activity_file` | Only with `ROUVY_MCP_EXPORT_DIR`: writes the Activity's FIT file or a CSV and returns its path. |

Try asking: *"How did my last ride go? Compare the first and second half of the climb."*

## Commands

```sh
npx -y rouvy-mcp login    # log in (or switch accounts)
npx -y rouvy-mcp status   # who is logged in, and whether a Session can still be opened
npx -y rouvy-mcp logout   # delete the credentials file
```

`logout` deletes the credentials file from your machine, but it can't revoke the refresh token on Rouvy's side. To make sure a copied credentials file stops working, change your Rouvy password.

## How it behaves

- It only calls the routes Rouvy's own web app calls, one request at a time, with an honest user agent (`rouvy-mcp/<version>`). It never polls and makes no requests while idle.
- If Rouvy's bot protection or rate limits push back, it stops and tells you when to try again, rather than retrying. A server error or a network failure gets one retry, 2 s later, and an expired Session is renewed once.
- No telemetry and no update check: the only requests it makes go to Rouvy.
- Nothing is cached on disk.

If a tool says Rouvy changed its API, update (restart your MCP client: `@latest` picks up the new version) or [open an issue](https://github.com/scastiel/rouvy-mcp/issues).

## Self-host on Cloudflare

The hosted server lets riders connect from a web client such as claude.ai, signing in with their Rouvy email and password on its own page instead of running anything locally. You can run your own, with the same code as the Public instance. This is **best effort, with no support promise**: if you only need it for yourself, the stdio server above costs nothing.

**You are the operator.** Riders hand your instance their Rouvy login, and it keeps their refresh tokens (encrypted) on your Cloudflare account. The duties that come with that (a privacy notice, answering access and erasure requests, shutting down if Rouvy objects) are yours, not the project's. Read [spec-m2 §10](docs/spec-m2.md#10-legal-gdpr-and-rouvy) before you invite anyone.

You need a Cloudflare account on **Workers Paid** ($5/month: tool calls take 57–305 ms of CPU, over the Free plan's 10 ms), a domain on that account, and Node.js 22 or later.

1. **Fork the repo** and clone your fork, then `npm ci` and `npx wrangler login`.
2. **Pick the Worker name and hostname** in `wrangler.toml`. `name` becomes a `workers.dev` hostname, so keep "rouvy" out of it, and out of your hostname too.
3. **Create the KV namespace** that holds clients, Grants and tokens, and paste the `id` it prints into `wrangler.toml`'s `[[kv_namespaces]]`:

   ```sh
   npx wrangler kv namespace create OAUTH_KV
   ```

   There's nothing to create for the Durable Object: the code puts it in the EU jurisdiction (`RIDERS.jurisdiction("eu")`), and the first deploy creates it.
4. **Keep both compatibility flags,** `nodejs_compat` and `global_fetch_strictly_public`. Without the second one, the OAuth provider refuses to fetch a client's metadata document, and claude.ai can't connect.
5. **Set the custom domain,** in `wrangler.toml` (`mcp.example.org` stands for yours):

   ```toml
   workers_dev = false
   routes = [{ pattern = "mcp.example.org", custom_domain = true }]

   [vars]
   PUBLIC_URL = "https://mcp.example.org"
   ```

   `PUBLIC_URL` is the bare origin, with no path or trailing slash. Its `/mcp` is the OAuth audience and sits in every rider's connector, so **never change the domain once riders have connected**: every Grant would stop working.
6. **Set the allow-list,** the Rouvy emails allowed to sign in, separated by commas or whitespace. Anyone else is told the instance is invite-only.

   ```sh
   npx wrangler secret put ALLOW_LIST
   ```

7. **Deploy** with `npm run deploy`, which stamps the version, then runs `wrangler deploy`. Check `https://mcp.example.org/.well-known/oauth-protected-resource/mcp`: its `resource` is `https://mcp.example.org/mcp`.
8. **Connect:** in claude.ai, add a custom connector with the URL `https://mcp.example.org/mcp`, sign in with an allow-listed Rouvy account, and ask for your last Activities.

**Running it:** [docs/operations.md](docs/operations.md) has how long Grants and tokens live, and how to [kill one rider](docs/operations.md#kill-one-rider), which is also how you handle an erasure request. To shut the instance down for good, follow the [Hard stop runbook](docs/runbooks/hard-stop.md). The repo's daily drift canary only checks the Public instance: watch your own `/health` (it runs the same account-free checks from your Worker's egress, and reports the block signals the runbook acts on).

## Disclaimer

**Unofficial project.** rouvy-mcp is not affiliated with, endorsed by, or supported by ROUVY or VirtualTraining s.r.o. "ROUVY" is a trademark of its owner.

Rouvy has no public API. This tool talks to Rouvy's private web API with **your own** account, from **your own** machine, and only reads data. Rouvy's [Terms of Use](https://rouvy.com/en/terms-of-use) (§29.h) prohibit reverse engineering and "using any automated means for accessing and using ROUVY". Using this tool may breach those terms, and Rouvy may suspend or terminate your account without a refund (§15, §29.d). The API may change or stop working at any time.

**Use at your own risk.** The software is provided "as is", without warranty of any kind (see LICENSE). The authors aren't responsible for any consequences to your Rouvy account or data. Nothing here is legal advice.

If you'd rather stay within Rouvy's terms, use Rouvy's official integrations (e.g. Intervals.icu, Strava, Garmin Connect) or request a copy of your data from Rouvy under the GDPR (gdpr@rouvy.com).

## License

[MIT](LICENSE)
