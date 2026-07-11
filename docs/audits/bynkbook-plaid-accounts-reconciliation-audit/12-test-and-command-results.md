# Test and Command Results

Audit date: 2026-07-10. All commands were read-only or local build/test operations. No production mutation was performed.

| Command or check | Result |
|---|---|
| `aws sts get-caller-identity --profile ledrigo-dev --query Account --output text` | PASS: `116846786465` |
| Production API route enumeration | PASS: 13 Plaid-related deployed routes; 12 direct Plaid routes plus cleanup overlap |
| Lambda configuration inspection | PASS: Node.js 22, Plaid production, production webhook, Secrets Manager IDs, KMS; sync 512 MB/45 s |
| EventBridge and SQS enumeration | PASS as inventory: no Plaid sync rule/queue found (finding -006) |
| CloudWatch log retention inspection | Logical Plaid groups configured for 30 days; some newest physical groups not yet present |
| Relevant targeted backend tests | PASS: 107 tests: Plaid 38, accounts 9, bank transactions 32, match-group revert 12, entry-delete safety 15, ledger summary 1 |
| Full backend tests | PASS: 23 files, 261 tests |
| Infra TypeScript | PASS |
| Functions TypeScript | PASS |
| Prisma validation | PASS; warning: deprecated `driverAdapters` preview feature |
| Frontend TypeScript | PASS |
| Frontend lint | PASS |
| Frontend production build | PASS: 34 routes |
| `npx sst build --stage prod` | NOT RUN AS BUILD: SST v3 reports no `build` command and prints usage. Not a code failure. |
| Aggregate-only production DB integrity probe | BLOCKED: connection to private `10.10.11.235:5432` timed out before SQL; no data returned; temporary script removed |
| Authenticated production Plaid/UI E2E | SKIPPED intentionally: no approved test identity or disposable Plaid Item; would mutate financial state |
| Frontend automated tests | UNAVAILABLE: no frontend test suite (existing BYNK-AUDIT-020) |

Testing limitations: unit tests mock Plaid and Prisma and cannot prove current production rows, bank-specific Link behavior, webhook delivery latency, IAM runtime reachability, or live reconciliation outcomes. AWS configuration proves deployment shape, not successful bank interaction. No raw customer, account, transaction, token, or secret data was read into the report.
