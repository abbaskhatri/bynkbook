# Founder mobile verification guide

Use synthetic/test data only. Run every check at 320x568 and 390x844; repeat critical flows at 430x932 and landscape. `Audit result` reflects this audit, not future implementation.

| Test | Page/action | Expected appearance/behavior | Warning signs | Audit result / findings |
|---|---|---|---|---|
| Navigation | Open each bottom item, More, back | Stable four/five-item nav; context preserved | Destinations change under `/mobile`; lost account/filter | Fail `006`,`007` |
| Dashboard | Open healthy and urgent business | Attention first; balances labeled with freshness | Many stacked cards; stale value looks current | Redesign `019` |
| Account list | Review bank/manual/archived accounts | Balance source, sync state, last success visible | Horizontal table; Plaid and local account confused | Fail `008`,`011` |
| Account detail | Open/reconnect/disconnect/archive | Action names scope and preserved history | Similar ambiguous buttons; raw Plaid code | Fail `008` |
| Transactions | Scan five mixed records | Identity/amount/date/account/status together | Horizontal scroll or color-only direction | Fail `005`,`007` |
| Reconciliation | Review suggestion and reject/confirm | Reason, linked record, amount/date/account, ledger effect | Switching panes; action off-screen | Fail `001` |
| Partial match | Allocate less than original | Original/matched/remaining stay visible | Remaining disappears; duplicate records | Fail `001`,`005` |
| Ledger | Scan/edit/open/delete-safe flow | Grouped rows; detail; explicit consequence | 13-column grid; tiny icons; tooltip-only action | Fail `002`,`015`,`016` |
| Vendor/AP | Open vendor, bill, payment allocation | Segmented lists; outstanding/applied/unapplied clear | Five wide tables; allocation in cramped dialog | Fail `003` |
| Upload invoice/receipt | Upload synthetic file, parse failure/success | Review-first copy; file state; full review | 980–1260px table; keyboard covered action | Fail `012`,`020` |
| Category review | Select several rows and apply | Visible selection mode/count/sticky action | Checkbox and action separated by scroll | Fail `010` |
| Forms | Open account/bill/entry form, keyboard, error, back | Labels remain; field visible; sticky submit; discard guard | Keyboard covers fields/actions; data lost | Unverified/fail design `020` |
| Dialogs/sheets | Open sort, confirmation, complex match | Pattern fits complexity; back closes once | Nested overlays; complex form in short sheet | Fail `004` |
| Reports | Read chart and statement | Text summary; values fit; drill-down | Tiny legend; horizontal detail rows | Redesign `013` |
| Errors/offline | Fail request during list and save | Last-good data; clear retry; typed data preserved | Blank screen; duplicate submit | Partial source support; runtime required |
| Accessibility | Large text, VoiceOver/TalkBack, switch control | Logical reading order and 44px targets | Truncation, hover-only help, table maze | Fail/risk `015`–`018` |

For every warning, record viewport, route, synthetic record, exact action, screenshot, console error if any, and finding ID. Do not use production customer names, balances, or documents.
