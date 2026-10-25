import { VERSION } from "./version.js";

export { VERSION } from "./version.js";

/** Sent on every request. Keep this shape: Cloudflare lets a semver'd `name/x.y.z (+url)` through. */
export const USER_AGENT = `rouvy-mcp/${VERSION} (+https://github.com/scastiel/rouvy-mcp)`;

/**
 * Rouvy's public Firebase web key, as it appears on account.rouvy.com's sign-in page.
 * Pinned rather than scraped; the daily canary checks it still matches.
 */
export const ROUVY_FIREBASE_WEB_KEY = "AIzaSyDx27rsmUbN9aZdqCPM7rBcuRPb2XVnQxM";

export const LOGIN_COMMAND = "npx -y rouvy-mcp login";
