# Mobile financial visibility audit

## Trust requirements

Every applicable mobile financial record must expose the following in the initial row or immediate detail header:

- amount, currency, and direction;
- transaction/expected date and posted date when different;
- account and counterparty/source;
- pending/posted and expected/actual distinction;
- unmatched/partial/matched/excluded state;
- remaining amount for partial/expected records;
- ledger effect and whether the action is reversible;
- balance source and freshness for account summaries.

## Current assessment

| Topic | Current evidence | Risk | Specification |
|---|---|---|---|
| Amount prominence | Right-aligned table columns, often off-screen from identity/action | Misassociation while scrolling | Amount stays in the row’s top-right; never scrolls away from identity |
| Positive/negative | Semantic colors/tokens exist | Color reliance if sign is clipped | Use sign + direction label/icon + color |
| Zero vs missing | Mixed table placeholders | `$0` can be read as known when absent | Zero renders `0.00`; missing renders em dash plus accessible “Not available” |
| Currency | USD format helpers dominate | Multi-currency is not proven | Show ISO code when context can differ; record unsupported multi-currency as product unknown |
| Decimal alignment | Tabular numbers present | Good pattern can be lost in cards | Preserve `font-variant-numeric: tabular-nums` and right alignment |
| Pending vs posted | Bank transaction state exists | State may be separated from amount/date | State label remains visible in row |
| Expected vs actual | Separate reconcile table/source labels | Users compare across panes | Use explicit `Expected` and `Bank` source labels in one queue/detail |
| Partial vs complete | Match models support partial | Remaining allocation is dialog/table context | Always show original, matched, remaining, linked records, next action |
| Excluded/removed source | Audit-preservation copy exists | Historical source can look active | Mark `Source removed`/`Excluded` without removing ledger history |
| Transfers/refunds/reversals | Transfer model and matching exist | Two legs can resemble duplicates | Use paired-transfer label and linked-leg detail |
| Account context | Header capsules and columns | Truncation/horizontal separation | Show account in each row when lists can cross accounts; otherwise sticky scope header |
| Balance freshness | Operations/Plaid state exists | Plaid vs ledger balance confusion | Label `Bank balance` and `Ledger balance` separately with `as of` time |
| High-risk actions | Consequence copy is generally strong | Hidden in title/dialog text on touch | Put consequence in visible review step and confirmation |

## Partial match presentation

```text
Transaction amount      -$1,240.00
Matched                    $800.00
Remaining                  $440.00
Linked records          Invoice 1042 · $500
                        Invoice 1048 · $300
Status                  Partial match
Next action             Allocate remaining
```

Amounts use the same sign convention throughout the flow. Allocation inputs show the effect immediately; confirm remains disabled until allocation is valid.

## Freshness presentation

Account cards show `Bank balance`, `Ledger balance`, `Difference`, `Last successful sync`, and a labeled state. `Syncing` does not erase the last-known value. `Delayed` and `Action required` explain the user action without raw Plaid codes.
