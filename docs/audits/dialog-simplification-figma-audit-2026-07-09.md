# Dialog Simplification + Figma Audit - 2026-07-09

This audit reviews the current dialog, modal, and dialog-like surfaces in BynkBook and recommends a simple Figma-led redesign path. The goal is not to make dialogs more decorative. The goal is to make fewer dialogs, simpler dialogs, and more predictable decisions.

## Executive summary

The app has a strong shared dialog foundation in `AppDialog`: fixed header/footer, body-only scrolling, tokenized colors, mobile bottom-sheet behavior, and reusable sizes. The bigger issue is workflow complexity. Many dialogs are being used for navigation hubs, review tables, and simple single-field edits that would be faster inline.

Current rough inventory from `bynkbook-web/src`:

| Area | AppDialog uses | Main issue |
|---|---:|---|
| Reconcile | 12 | Several review and hub dialogs; history/audit/issue flows stack into each other. |
| Settings | 11 | Many single-object edit/delete/confirm dialogs. |
| Ledger | 7 | Mostly safety confirmations and utility dialogs. |
| Vendor detail | 7 | Bill/payment/edit/delete/void flows; mostly valid but visually dense. |
| Plaid connect | 4 | Multi-step connection flow split across several dialogs. |
| Uploads, issues, auto reconcile, planning, category review | 1 each | Larger review dialogs need simpler layout rules. |

Highest-impact strategy:

1. Remove low-value dialogs first: navigation hubs, simple text edits, non-destructive previews.
2. Redesign remaining dialogs around 4 simple templates in Figma.
3. Update `AppDialog` and `DialogFooter` once, then migrate the heavy dialogs gradually.

## Dialog simplicity rules

Use these as the design acceptance criteria in Figma and code:

| Rule | Standard |
|---|---|
| One job | A dialog should answer one user question or complete one action. |
| One primary action | Footer should have one primary button, one cancel/close, and optional quiet helper text. |
| Three content zones max | Summary, inputs/review, warning/result. More than that should become a full page or side panel. |
| No navigation hubs | If the dialog only asks "which tool do you want?", use a menu or inline toolbar. |
| No table-first dialogs | Use compact review rows/cards. Keep tables only for true comparison and cap columns hard. |
| Small confirmations | Destructive confirmations should be short, typed only for irreversible/high-risk actions. |
| Simple radii | Inside dialogs, prefer `rounded-md` or `rounded-lg`; avoid nested rounded-xl/2xl card stacks. |
| Mobile first | On narrow screens, actions stack full-width and review rows become cards. |

## What to redesign in Figma

Create a single Figma page named `Dialog Simplification` with these component variants and example frames.

### 1. Base dialog kit

Use the existing `AppDialog` behavior as the source of truth, then design cleaner variants:

- `Dialog / Form / sm`
- `Dialog / Confirm / xs`
- `Dialog / Review / md`
- `Dialog / Bulk Review / lg-xl`
- `Dialog / Blocking Progress / sm`

Figma should define spacing, footer behavior, warning placement, mobile layout, and max content density. This lets engineering improve the primitive once instead of hand-polishing every modal.

Code anchor: `bynkbook-web/src/components/primitives/AppDialog.tsx`.

Recommended primitive tweaks:

- Add optional `description` below title for concise context.
- Add a standard footer layout prop or helper that always right-aligns actions and wraps cleanly.
- Add a `tone="default|danger|warning"` variant for confirm dialogs.
- Reduce nested content radius inside dialogs to 6-8px.
- Consider a `DialogSection` primitive for consistent summary/warning/review sections.

### 2. Confirmation template

Use for delete, archive, void, reset, revert, remove member, and unmatch flows.

Target design:

- Title: action in plain English, e.g. `Delete vendor`.
- One sentence: what will happen.
- Optional compact impact list: 2-3 bullets max.
- Typed confirmation only for irreversible actions: delete business, reset business, hard delete/permanent delete.
- Footer: Cancel + destructive action.

High-value code anchors:

- `bynkbook-web/src/app/(app)/settings/page-client.tsx:2473` - Delete account.
- `bynkbook-web/src/app/(app)/settings/page-client.tsx:3563` - Remove member.
- `bynkbook-web/src/app/(app)/settings/page-client.tsx:3613` - Archive/unarchive account.
- `bynkbook-web/src/app/(app)/settings/page-client.tsx:3686` - Reset business.
- `bynkbook-web/src/app/(app)/settings/page-client.tsx:3766` - Delete business.
- `bynkbook-web/src/app/(app)/ledger/page-client.tsx:5389` - Delete ledger entry.
- `bynkbook-web/src/app/(app)/reconcile/page-client.tsx:6959` - Revert bank match.

### 3. Compact form template

Use for create/edit account, edit vendor, new bill, apply payment, export options, and void bill.

Target design:

- Two-column forms only when labels and values stay readable; otherwise single column.
- Inline helper text directly below the relevant field, not in large cards.
- Footer helper text should be one line and factual.
- Never show fields that do not apply to the selected mode.

High-value code anchors:

- `bynkbook-web/src/app/(app)/settings/page-client.tsx:2100` - Create account.
- `bynkbook-web/src/app/(app)/settings/page-client.tsx:2603` - Edit account.
- `bynkbook-web/src/app/(app)/vendors/[vendorId]/page-client.tsx:1467` - New/edit bill.
- `bynkbook-web/src/app/(app)/vendors/[vendorId]/page-client.tsx:2536` - Edit vendor.
- `bynkbook-web/src/app/(app)/ledger/page-client.tsx:5736` - Export ledger.
- `bynkbook-web/src/app/(app)/ledger/page-client.tsx:5823` - Print ledger.

### 4. Review list template

Use for match suggestions, auto-fix issues, duplicate issue review, snapshots, reconciliation history, and audit detail.

Target design:

- Summary strip at top: selected, ready, review, blocked.
- Row cards with one primary fact line, one metadata line, and clear state chip.
- Bulk actions in a simple top-right control group.
- No nested card-on-card stacks.
- Keep advanced evidence behind a disclosure row or detail side panel.

High-value code anchors:

- `bynkbook-web/src/components/reconcile/auto-reconcile-dialog.tsx:622` - Match suggestions.
- `bynkbook-web/src/components/issues/auto-fix-issues-dialog.tsx:293` - Auto Fix Issues.
- `bynkbook-web/src/components/ledger/fix-issue-dialog.tsx:352` - Fix issue dialog.
- `bynkbook-web/src/app/(app)/reconcile/page-client.tsx:5539` - Manual match.
- `bynkbook-web/src/app/(app)/reconcile/page-client.tsx:6099` - Entry to bank match.
- `bynkbook-web/src/app/(app)/reconcile/page-client.tsx:6564` - Reconciliation history.
- `bynkbook-web/src/app/(app)/reconcile/page-client.tsx:6757` - Audit detail.

## Highest-priority simplifications

### P0 - Remove hub dialogs in Reconcile

The Reconcile page has a healthier toolbar pattern now, but still includes dialogs that mainly route to other actions.

Replace these with menu/popover actions:

- Export hub at `bynkbook-web/src/app/(app)/reconcile/page-client.tsx:7298`.
- Issues info micro-dialog at `bynkbook-web/src/app/(app)/reconcile/page-client.tsx:7277`; use inline helper text or toast.
- Consider moving Snapshots from a modal into a side panel or page if it grows further.

Why: a navigation dialog adds a decision before the real decision. Menus are simpler.

### P0 - Simplify Reconcile Create Entry

`bynkbook-web/src/app/(app)/reconcile/page-client.tsx:3436` is a major moment in the workflow and should be made visually quieter.

Figma target:

- Header: `Create ledger entry`.
- Summary row: bank date, payee, amount.
- Editable fields: only fields the user can change.
- Warnings: only show duplicate/auto-match warning when relevant.
- Footer: Cancel, `Create entry`, or `Create and match`.

Avoid showing duplicate suggested/current rows unless values differ.

### P1 - Turn simple issue fixes inline

`MISSING_CATEGORY` does not need a dialog. It needs a category picker on the row.

Keep `FixIssueDialog` only for:

- Duplicate review.
- Stale check review.
- Cases where multiple entries are affected.

Code anchors:

- `bynkbook-web/src/components/ledger/fix-issue-dialog.tsx:352`.
- `bynkbook-web/src/app/(app)/issues/page-client.tsx:1156`.

### P1 - Redesign Auto Fix Issues

`AutoFixIssuesDialog` is functionally useful but visually heavy: rounded-xl/2xl sections, stacked buckets, many chips, and several repeated empty states.

Figma target:

- Top summary: `Safe`, `Review`, `Unsupported`.
- Default open section: safe fixes only.
- Other buckets collapsed by default.
- Apply button says `Apply safe fixes` and uses sentence case.
- Result state replaces preview summary instead of adding another large section.

Code anchor: `bynkbook-web/src/components/issues/auto-fix-issues-dialog.tsx:293`.

### P1 - Redesign Match Suggestions

`AutoReconcileDialog` has good deterministic logic but too many controls compete visually: summary counts, select ready/all/clear, row chips, review/apply two-step footer.

Figma target:

- Header summary: `Ready`, `Needs review`, `Selected`.
- Selection controls: compact segmented/check actions, not three equal buttons.
- Rows: bank transaction on left, matched entry or split summary on right.
- Show only the best reason by default; disclose all reasons if expanded.
- Footer: Close + `Review selected` or `Apply selected`.

Code anchor: `bynkbook-web/src/components/reconcile/auto-reconcile-dialog.tsx:622`.

### P1 - Settings inline edit pass

Settings still uses dialogs for some simple object edits. Use inline edit where only one text value changes.

Keep dialogs for:

- Create account.
- Delete/archive/reset business/account safety.
- Role/member actions.
- Plaid review.

Move toward inline edit for:

- Account display name when no structural fields are changing.
- Category name.
- Vendor name.
- Business display name if it is a single field.

Code anchor: `bynkbook-web/src/app/(app)/settings/page-client.tsx:2100`.

### P2 - Plaid flow stepper

Plaid currently uses separate dialogs for confirm connection, account selection, opening balance review, and sync progress.

Figma target:

- One `Connect bank` modal with 3 steps: confirm, choose account/history, review opening balance.
- Blocking sync progress can remain separate only if the app cannot safely close it.
- Use a small step indicator, not large explanatory cards.

Code anchors:

- `bynkbook-web/src/components/plaid/PlaidConnectButton.tsx:278`.
- `bynkbook-web/src/components/plaid/PlaidConnectButton.tsx:356`.
- `bynkbook-web/src/components/plaid/PlaidConnectButton.tsx:534`.
- `bynkbook-web/src/components/plaid/PlaidConnectButton.tsx:649`.

## Figma workflow

Use Figma to decide interaction shape before implementation, not just visual styling.

1. Create a `Dialog Simplification` page.
2. Import or recreate the shared tokens: surfaces, borders, text, danger, warning, success, primary.
3. Build the 5 dialog component variants listed above.
4. Make before/after frames for the 6 priority flows:
   - Reconcile create entry.
   - Match suggestions.
   - Auto Fix Issues.
   - Fix duplicate issue.
   - Settings delete/reset confirmations.
   - Plaid connect flow.
5. Add annotations for what should become inline, menu, side panel, or remain a modal.
6. Validate each frame at desktop and mobile widths.
7. Convert the agreed Figma components back into `AppDialog`, `DialogFooter`, and small dialog section primitives.

Recommended Figma frame sizes:

| Frame | Size |
|---|---|
| Desktop dialog canvas | 1440 x 1000 |
| Desktop modal component | 560, 672, 896 widths |
| Mobile dialog/bottom sheet | 390 x 844 |
| Dense review dialog | 896 x 760 |

## Implementation roadmap

### Pass 1 - Primitive cleanup

- Add `description` and `tone` support to `AppDialog`.
- Add a consistent `DialogSection`/`DialogNotice` pattern.
- Normalize inside-dialog radii to 6-8px.
- Normalize footer actions through `DialogFooter`.

### Pass 2 - Remove unnecessary dialogs

- Export hub to menu.
- Issues info dialog to inline message/toast.
- Missing category issue fix to inline row control.
- Simple single-field settings edits to inline edit.

### Pass 3 - Redesign heavy review dialogs

- Auto Fix Issues.
- Auto Reconcile Match Suggestions.
- Fix Duplicate Issue.
- Reconcile manual match / entry match.

### Pass 4 - Multi-step flows

- Plaid connect as one stepper dialog.
- Create account/create manual account review cleanup.
- Upload panel simplification if it remains visually heavy after the primitive cleanup.

## Success metrics

Use these to know the simplification worked:

- Reconcile common actions require fewer modal opens.
- Dialogs have one primary action visible at a time.
- No dialog has more than 3 visually dominant sections.
- No confirmation uses typed text unless the action is irreversible or high-risk.
- Mobile screenshots show no horizontal content clipping.
- Users can close or complete every dialog from the footer without hunting inside content.

## First build recommendation

Start with the Figma component kit plus three before/after frames:

1. Reconcile Create Entry.
2. Auto Fix Issues.
3. Settings destructive confirmation.

Those three cover the main patterns: compact form, bulk review, and safety confirm. Once those are approved, the same templates can be applied across the rest of the app without making every dialog a custom project.
