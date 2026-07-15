# Mobile ledger audit

## Current structure

The Ledger route is a 5,957-line client component. Its canonical table exposes Date, Ref, Payee, Type, Method, Category, Amount, Balance, Status, two issue columns, and Actions. Inline add/edit/category/fix/delete interactions use 24–32px controls and dialogs. The shared table intentionally scrolls horizontally.

## Recommended list hierarchy

```text
DATE GROUP: Today · Jul 15

QA Fuel Center                         -$126.41
Operations Checking · Fuel          Posted
Jul 15 · Card •••• 2048        Needs category
```

- Top: payee/memo and signed amount.
- Middle: account and explicit status.
- Bottom: absolute date, method/source/category, and one action-required label.
- A zero amount remains `0.00`; missing is `—` with an accessible label.
- Entire row opens detail. A visible overflow action offers only safe secondary actions.

## Detail-page sections

1. Header: payee, amount, status, date, account.
2. Accounting: type, method, category, balance effect, closed-period state.
3. Source: bank/upload/manual and freshness.
4. Linked records: match group, bill/payment/transfer where applicable.
5. Notes/ref/attachments.
6. Issues and recommended fix.
7. Activity/history.
8. Actions: edit, apply, unmatch, restore, move to deleted, hard delete—ordered and permission-aware.

## Ordering and movement

- Default activity is chronological by effective/transaction date according to existing business behavior; the mobile design must label date meaning when multiple dates exist.
- Matched entries remain in chronological activity and disappear only from unresolved emphasis.
- Deleted/restored state never creates an unlabeled duplicate.
- Filters, grouping, account, scroll anchor, and selected tab survive detail navigation.

## Bulk/inline edit

Mobile should not reproduce the full spreadsheet editor. Single-record edits use a dedicated form. Bulk operations enter a named selection mode with checkboxes, selected count, cancel, and one safe action. Hard delete never appears in a swipe action or without review.

## Performance

Keep incremental loading and last-good data. Validate row rendering with 50, 500, and 5,000 synthetic entries. If the mobile list does not already virtualize, use a screen-reader-compatible virtualization approach and restore scroll by stable entry ID rather than pixel only.
