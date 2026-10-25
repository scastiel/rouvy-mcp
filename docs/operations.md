# Operating the hosted server

For whoever runs an instance: the maintainer for the Public instance, a self-hoster for theirs. Run the commands from a checkout of the repo, logged in with `npx wrangler login`. See [spec-m2 §6](spec-m2.md#6-token-custody-and-sessions) for why it works this way.

## How long things live

- **Access tokens:** 1 hour.
- **Grants:** each refresh pushes the expiry to 30 days later, with no hard cap. A Grant unused for 30 days is deleted.
- **Clients registered dynamically (DCR):** 90 days.
- **A rider's instance** in the Durable Object (live Session, cookies, caches): dropped after 30 minutes idle, when their Grant ends, and whenever the Durable Object is evicted.

A Grant ends by itself when Firebase says the rider's login is over (password changed, account disabled or deleted, refresh token revoked): `/mcp` answers 401, the client's refresh gets `invalid_grant`, and the rider is back on the sign-in page. Rouvy or Firebase being down never ends a Grant: tools answer "try again later".

## Kill one rider

Also how a GDPR erasure request is handled. There is no admin route on the Worker: it's done with wrangler.

1. **Remove their email from the allow-list,** so they can't sign in again: `npx wrangler secret put ALLOW_LIST`, then paste the list without it.
2. **Find their uid** (their Firebase uid, the `userId` of their Grants). KV holds no emails, by design, so match on what each Grant shows, the client and the creation date:

   ```sh
   npx wrangler kv key list --binding OAUTH_KV --remote --prefix "grant:" | jq -r '.[].name'
   npx wrangler kv key get --binding OAUTH_KV --remote "grant:<uid>:<grantId>" | jq '{clientId, createdAt: (.createdAt | todate)}'
   ```

3. **Delete their Grants and tokens:**

   ```sh
   uid=<their uid>
   for prefix in "grant:$uid:" "token:$uid:"; do
     npx wrangler kv key list --binding OAUTH_KV --remote --prefix "$prefix" | jq '[.[].name]' > keys.json
     npx wrangler kv bulk delete keys.json --binding OAUTH_KV --remote --force
   done
   rm keys.json
   ```

4. **Check:** both listings are now empty, and the rider's next request gets 401. Their client's refresh fails too, and the sign-in page tells them the instance is invite-only. Their in-memory Session is gone within 30 minutes.

Ending every Grant at once is the Hard stop: delete the KV namespace and the Worker ([spec-m2 §9](spec-m2.md#9-operations)).
