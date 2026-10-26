// `npm run contract:live [-- --writes]`: the maintainer's check against the live Rouvy.
// vitest refuses options it doesn't know, so `--writes` travels as ROUVY_MCP_CONTRACT_WRITES.
// Without it, the run never writes a Workout (test/drift/contract.live.ts enforces it).
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const writes = args.includes("--writes");
const result = spawnSync(
  "npx",
  ["vitest", "run", "--config", "vitest.live.config.ts", "contract.live", ...args.filter((arg) => arg !== "--writes")],
  { stdio: "inherit", env: { ...process.env, ROUVY_MCP_CONTRACT_WRITES: writes ? "1" : "" } },
);
process.exit(result.status ?? 1);
