# Plaid Link Token and Item Audit

## Observed implementation

Link-token creation requests Transactions for the US, English locale, up to 730 days of history, and the deployed production webhook. `client_user_id` is the Cognito subject. Account-scoped update mode decrypts and supplies the existing access token, preserving the Item as Plaid recommends.

Public-token exchange occurs only on the backend. The backend verifies that each selected Plaid account belongs to the returned Item, prevents a selected Plaid account ID from being linked twice in the same business, encrypts the access token with KMS, and stores ciphertext. Production Lambdas reference `ledrigo-prod/plaid/client_id` and `ledrigo-prod/plaid/secret` and report `PLAID_ENV=production`.

The webhook URL in Lambda configuration is `https://cpjh7t19u1.execute-api.us-east-1.amazonaws.com/v1/plaid/webhook`. The older `actwy6st05` hostname in supplied audit material is stale, matching existing finding BYNK-AUDIT-005.

## Security and ownership conclusions

- No access-token plaintext path to the frontend was found.
- Webhook ES256 JWT, key, issuance time, and exact body hash are verified before processing.
- Cross-business account checks are present.
- Mutation authorization is membership-only (BYNK-PLAID-AUDIT-013 / BYNK-AUDIT-007).
- Reconnect selection proves only that the account is live on the Item, not that it is the original/type-compatible account (BYNK-PLAID-AUDIT-005).
- Disconnect never calls Plaid `/item/remove`, so final authorization/billing termination is not implemented (BYNK-PLAID-AUDIT-009).
- Multi-account creation is not one atomic unit (BYNK-PLAID-AUDIT-010).

Official behavior references: [Transactions API](https://plaid.com/docs/api/products/transactions/), [Link update mode](https://plaid.com/docs/link/update-mode/), [Link and public-token exchange](https://plaid.com/docs/api/link/), and [webhook verification](https://plaid.com/docs/api/webhooks/webhook-verification/).
