# Complete mobile findings register

Canonical machine-readable source: `mobile-ui-ux-audit-findings.json`.

## Sorted register

| Priority | Finding | Severity | Task impact | Trust impact | Frequency | Recommendation |
|---:|---|---|---|---|---|---|
| 1 | `001` Reconcile dual desktop tables | HIGH | High | High | Every session | Guided queue/detail |
| 2 | `002` Ledger context fragmentation | HIGH | High | High | Every session | Grouped rows/detail |
| 3 | `004` Complex generic bottom sheets | HIGH | High | High | Frequent | Complexity-based overlays/routes |
| 4 | `005` Financial direction/state priority | HIGH | High | High | Every list | Canonical financial row |
| 5 | `003` Vendor/AP wide tables | HIGH | High | High | Every AP review | Segmented detail |
| 6 | `008` Plaid action taxonomy | HIGH | High | High | Episodic high-risk | Full-screen lifecycle flow |
| 7 | `007` Missing record detail routes | HIGH | High | High | Frequent | Route-backed details |
| 8 | `006` Competing mobile navigation | HIGH | High | Medium | Cross-route | One IA |
| 9 | `009` Filters consume first viewport | HIGH | High | Medium | Every filtered list | Search/chips/sheet |
| 10 | `015` 28–36px controls | MEDIUM | Medium | Medium | Constant | Explicit 44px mobile variants |
| 11 | `016` Tooltip-only explanations | MEDIUM | Medium | High | Frequent | Labeled action sheet |
| 12 | `020` Keyboard/unsaved behavior | MEDIUM | Medium | High | Frequent | Full-screen forms |
| 13 | `010` Category review table | MEDIUM | Medium | Medium | Frequent | Selection list |
| 14 | `011` Accounts table | MEDIUM | Medium | High | Periodic | Account cards |
| 15 | `012` Upload tables | MEDIUM | Medium | Medium | Periodic | File list/review |
| 16 | `017` Table semantic alternative | MEDIUM | Medium | Medium | AT users | Semantic list/detail |
| 17 | `018` Text scaling risk | MEDIUM | Medium | Medium | Preference-dependent | Reflow-safe rows |
| 18 | `019` Dashboard priority | MEDIUM | Medium | Medium | Daily | Attention-first sections |
| 19 | `013` Reports density | MEDIUM | Medium | Medium | Periodic | Statement rows/summary |
| 20 | `014` Planning inline edit | MEDIUM | Medium | Medium | Periodic | Summary + form |
| 21 | `021` Long public landing | LOW | Low | Low | First visit | Condense |
| 22 | `024` 32px header utilities | LOW | Low | Low | Constant | 44px icon button |
| 23 | `022` Strong login pattern | INFO | Positive | Positive | Session start | Preserve |
| 24 | `023` Reconcile virtualization strength | INFO | Positive | Positive | Large data | Preserve |
| 25 | `025` Local E2E env limitation | INFO | Validation | Medium | Audit/CI | Synthetic fixture |

## Severity rationale

No finding is marked CRITICAL because the audited evidence shows workarounds and no confirmed production data corruption or security exposure. HIGH findings nevertheless block a professional mobile release because users cannot reliably evaluate identity, amount, state, and consequence together.
