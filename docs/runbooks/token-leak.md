# Runbook: suspected token leak

When a Grant, the KV namespace or a rider's Firebase refresh token may have leaked ([spec-m2 §9](../spec-m2.md#9-operations)).

## Steps

1. Delete the KV namespace right away; every Grant dies.
2. Redeploy with a fresh namespace.
3. Email riders advising a Rouvy password change, which kills any leaked Firebase refresh token.
4. Assess breach notification within 72 h: GDPR Art. 33, and the CAI under Law 25 when there's a risk of serious injury ([spec-m2 §10](../spec-m2.md#10-legal-gdpr-and-rouvy)).

## What the logs can tell

Workers Logs keep 7 days of our own structured events, and nothing that identifies a rider: no uid, email, IP address, token or `props`. Match a rider's report by timestamp. `grant_created`, `grant_revoked` and `refresh_token_rotated` events show when Grants came and went, and how often Firebase handed back a new refresh token.
