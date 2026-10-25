// What wrangler.toml's compatibility flags give the deployed Worker; the provider reads it to enable CIMD.
(globalThis as { Cloudflare?: unknown }).Cloudflare = { compatibilityFlags: { global_fetch_strictly_public: true } };
