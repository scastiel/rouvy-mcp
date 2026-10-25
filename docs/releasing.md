# Releasing rouvy-mcp

Releases are `0.x` semver, published by [`.github/workflows/release.yml`](../.github/workflows/release.yml) when a `v<version>` tag is pushed, with npm trusted publishing: no npm token anywhere, provenance attached. Fixes for Rouvy drift ship as patch releases (spec §10).

## Every release

1. On `main`, with CI green: run `npm run contract:live` on your machine (it uses your own credentials file; run `npx -y rouvy-mcp login` first if needed). It must pass right before the release.
2. Bump the version in a PR: `npm version <patch|minor> --no-git-tag-version`, commit `package.json` and `package-lock.json`, merge.
3. Tag the merged commit and push the tag:

   ```sh
   git checkout main && git pull
   git tag v$(node -p "require('./package.json').version")
   git push origin --tags
   ```

4. Watch the **Release** workflow. It refuses a tag that doesn't match `package.json`, runs typecheck, build and tests, publishes, then creates the GitHub release with generated notes.
5. Check: `npm view rouvy-mcp version` shows the new version, and the npm page shows the provenance badge.

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
