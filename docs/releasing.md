# Releasing rouvy-mcp

Releases are `0.x` semver, published by [`.github/workflows/release.yml`](../.github/workflows/release.yml) when a `v<version>` tag is pushed, with npm trusted publishing: no npm token anywhere, provenance attached. Fixes for Rouvy drift ship as patch releases (spec §10).

## Every release

1. On `main`, with CI green: run `npm run contract:live` on your machine (it uses your own credentials file; run `npx -y rouvy-mcp login` first if needed). It must pass right before the release. For a release that touches Workouts, run `npm run contract:live -- --writes` instead: it also creates, edits and deletes a *rouvy-mcp contract — delete me* Workout in your library, and deletes it even when a step fails. Without `--writes`, it never writes a Workout.
2. Bump the version in a PR: `npm version <patch|minor> --no-git-tag-version`, commit `package.json`, `package-lock.json` and `src/version.ts` (`npm version` rewrites it: nothing reads `package.json` at runtime), merge.
3. Tag the merged commit and push the tag:

   ```sh
   git checkout main && git pull
   tag=v$(node -p "require('./package.json').version")
   git tag "$tag"
   git push origin "$tag"
   ```

4. Watch the **Release** workflow. It refuses a tag that doesn't match `package.json`, runs typecheck, build and tests, publishes, then creates the GitHub release with generated notes.
5. Check: `npm view rouvy-mcp version` shows the new version, and the npm page shows the provenance badge.

## After an MCP SDK bump

Tests talk to the server over the SDK's in-memory pair and send raw `server/discover` and `initialize` to the built bin, but no real client. Before tagging, check the bin from the branch in both clients:

1. `npm run build`, then point each client at the build instead of npm: `"command": "node", "args": ["/absolute/path/to/rouvy-mcp/dist/bin.js"]` in Claude Desktop's `claude_desktop_config.json`, and `claude mcp add rouvy-local -- node /absolute/path/to/rouvy-mcp/dist/bin.js` in Claude Code.
2. Restart the client: the server shows as connected, with its tools listed (`/mcp` in Claude Code).
3. Ask for each tool in turn: your last Activities (`list_activities`), that Activity's summary (`get_activity`), its 5-minute splits (`get_activity_intervals`), stats from minute 10 to 20 (`get_window_stats`), its power and heart rate as a chart (`get_activity_streams`), and, with `ROUVY_MCP_EXPORT_DIR` set, an export to CSV (`export_activity_file`). Then your Workouts (`list_workouts`) and one of them (`get_workout`), and a throwaway Workout that you create, rename and delete (`create_workout`, `update_workout`, `delete_workout`): the client should ask before the two destructive ones.
4. Run `node dist/bin.js logout` (or point `XDG_CONFIG_HOME` at an empty folder), ask again: the answer is the *Not logged in* message naming `npx -y rouvy-mcp login`.
5. Put the clients back on `rouvy-mcp@latest`.

## First release only (0.1.0)

These need the maintainer: npm account, repo admin. In this order, because provenance only works from a public repo, and npm only lets you configure a trusted publisher for a package that already exists.

1. **Merge the release PR** (README, release workflow, `0.1.0` in `package.json`).
2. **Rename the repo** to `rouvy-mcp`. `package.json`'s `repository.url` already says `scastiel/rouvy-mcp`, and trusted publishing checks it exactly.

   ```sh
   gh repo rename rouvy-mcp --repo scastiel/rouvymcp
   git remote set-url origin git@github.com:scastiel/rouvy-mcp.git   # in each local clone
   ```

   GitHub redirects the old URLs, so links to `scastiel/rouvymcp` in the spec and issues keep working.
3. **Make the repo public**, together with the release. Every branch and all history go public, not just `main`. A scan before 0.1.0 found no tokens, emails or real Activity ids in any committed file across all branches: fixtures are redacted, and the one real-looking id is quoted from another project's public fixture. Delete any branch you'd rather not publish first.

   ```sh
   gh repo edit scastiel/rouvy-mcp --visibility public --accept-visibility-change-consequences
   ```

4. **Reserve the name on npm with a placeholder `0.0.0`**, published by hand. It exists only so the trusted publisher can be configured; it has no `bin`.

   ```sh
   npm login
   dir=$(mktemp -d) && cd "$dir"
   printf '{\n  "name": "rouvy-mcp",\n  "version": "0.0.0",\n  "description": "Unofficial Rouvy MCP server (placeholder: use 0.1.0 or later)",\n  "license": "MIT",\n  "repository": { "type": "git", "url": "git+https://github.com/scastiel/rouvy-mcp.git" }\n}\n' > package.json
   echo "Placeholder. See https://github.com/scastiel/rouvy-mcp" > README.md
   npm publish
   npm deprecate rouvy-mcp@0.0.0 "Placeholder: use rouvy-mcp@latest"
   ```

5. **Configure the trusted publisher** on npmjs.com → `rouvy-mcp` → Settings → Trusted publishing → GitHub Actions. The fields are case-sensitive:
   - Organization or user: `scastiel`
   - Repository: `rouvy-mcp`
   - Workflow filename: `release.yml`
   - Environment: leave empty

   The first publish must follow within 2 days of saving it. Then, under Publishing access, choose **Require two-factor authentication and disallow tokens**: from now on only the workflow can publish.
6. **Run `npm run contract:live`**, then **tag and push `v0.1.0`** (steps 1, 3–5 of *Every release*).
7. **Smoke-test from a clean machine** (or a fresh user account with an empty npx cache): add `npx -y rouvy-mcp@latest` to an MCP client, run `npx -y rouvy-mcp login`, and ask for your last ride.
