# Host probe (throwaway, never merged)

For the wayfinder task [Probe Rouvy from candidate hosts](https://github.com/scastiel/rouvymcp/issues/33). Plan from [Hosting platforms and egress to Rouvy's Cloudflare](https://github.com/scastiel/rouvymcp/issues/32).

Rules (politeness charter): honest UA, one request at a time, ≥ 1 s apart, stop at the first Cloudflare 403, never retried, never look for rate thresholds. No password login anywhere: the authenticated step reuses your refresh token (securetoken refresh + `auth.data`), which is what the hosted server would do per grant anyway. Output carries only statuses, header names, timings, counts and a hashed egress IP.

## What's here

| File | What |
|---|---|
| `checks.ts` | account-free checks: egress (hashed IP, ASN), anonymous list `.data` (expect 202 → sign-in), sign-in page (pinned Firebase key), bogus Firebase sign-in (expect `INVALID_LOGIN_CREDENTIALS`) |
| `authed.ts` | one refresh + one list page + one detail + its Activity file, via the real M1 client |
| `bench.ts`, `make-inputs.ts` | CPU workloads on a synthetic 1 h Activity file and a ~490 KB detail built from the redacted fixtures |
| `node.ts` | Node entry (home, Fly.io, VPS): `tsx node.ts checks|bench|authed|all` |
| `worker.ts`, `build-worker.mjs`, `wrangler.jsonc` | Worker entry: the same routes behind `Authorization: Bearer $PROBE_KEY`, plus `POST /mcp` running the real `createServer()` |
| `Dockerfile`, `fly.toml` | long-lived container you run the probe inside |

Setup once: `npm ci` at the repo root, then `cd probe && npm install && npx tsx make-inputs.ts`.

## Checklist

### 1. Cloudflare Workers (free account)

```sh
cd probe
npx wrangler login
node build-worker.mjs
npx wrangler deploy
openssl rand -hex 24 | tee /tmp/probe-key | npx wrangler secret put PROBE_KEY
URL=https://rouvy-mcp-probe.<your-subdomain>.workers.dev
K="authorization: Bearer $(cat /tmp/probe-key)"
curl -s -H "$K" $URL/checks          # account-free
curl -s -H "$K" $URL/bench/detail    # then read CPU time in the dashboard: Workers → rouvy-mcp-probe → Observability
curl -s -H "$K" $URL/bench/fit
```

Only if `/checks` all pass, the authenticated step (puts your refresh token in a Worker secret; delete the Worker after):

```sh
jq -r .refreshToken ~/.config/rouvy-mcp/credentials.json | npx wrangler secret put ROUVY_REFRESH_TOKEN
jq -r .uid ~/.config/rouvy-mcp/credentials.json | npx wrangler secret put ROUVY_UID
curl -s -H "$K" $URL/authed
```

Tear down: `npx wrangler delete rouvy-mcp-probe`.

### 2. Fly.io (needs a card; ~$0.10 for a few days)

From the repo root:

```sh
fly apps create rouvy-mcp-probe
fly deploy -c probe/fly.toml --dockerfile probe/Dockerfile
fly ssh console -C "sh -c 'PROBE_HOST=fly npx tsx node.ts checks'"
fly ssh console -C "sh -c 'PROBE_HOST=fly npx tsx node.ts bench'"
```

Authenticated step, only if checks pass:

```sh
fly secrets set ROUVY_REFRESH_TOKEN="$(jq -r .refreshToken ~/.config/rouvy-mcp/credentials.json)" ROUVY_UID="$(jq -r .uid ~/.config/rouvy-mcp/credentials.json)"
fly ssh console -C "sh -c 'PROBE_HOST=fly npx tsx node.ts authed'"
```

Egress stability: `fly deploy` again (or `fly machine restart`) and re-run `checks`; compare `ipHash`. Tear down: `fly apps destroy rouvy-mcp-probe`.

### 3. A VPS (Hetzner CX/CPX, or any VPS you already have)

```sh
rsync -a --exclude node_modules --exclude .git ./ root@<vps>:/root/rouvymcp/
ssh root@<vps> 'cd /root/rouvymcp && docker build -f probe/Dockerfile -t rouvy-mcp-probe . && docker run -d --name probe rouvy-mcp-probe'
ssh root@<vps> 'docker exec -e PROBE_HOST=vps probe npx tsx node.ts checks'
ssh root@<vps> 'docker exec -e PROBE_HOST=vps probe npx tsx node.ts bench'
```

Authenticated step, only if checks pass (pass the token as env to that one exec):

```sh
ssh root@<vps> "docker exec -e PROBE_HOST=vps -e ROUVY_REFRESH_TOKEN=$(jq -r .refreshToken ~/.config/rouvy-mcp/credentials.json) -e ROUVY_UID=$(jq -r .uid ~/.config/rouvy-mcp/credentials.json) probe npx tsx node.ts authed"
```

Tear down: `docker rm -f probe` and delete the server.

### 4. Over ~3 days

Re-run the account-free `checks` once a day on each host that stays up. Some blocks show up only after a reputation update.

### 5. Report

Paste each JSON output as a comment on the ticket (it carries no tokens, ids, or raw IPs).
