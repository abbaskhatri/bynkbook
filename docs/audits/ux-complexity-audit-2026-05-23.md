# UX Complexity Audit — 2026-05-23

This is a **read-only audit**. No code is changed in this PR. The goal: identify workflows where the user has to do too much — too many clicks, too many dialogs, too many confirmations — and propose concrete simplifications that don't sacrifice safety.

## Complexity heat map

Quick instrumental survey of the page-clients:

| Page              | Dialogs | Confirmations | Notes                                       |
|-------------------|--------:|--------------:|---------------------------------------------|
| **reconcile**     |     32  |           12  | Biggest target. 14+ inline AppDialogs.       |
| **settings**      |     27  |           12  | "Edit X" dialogs proliferate.                |
| **closed-periods**|      1  |            8  | Confirm-heavy for low-risk actions.          |
| **category-review**|     3  |            1  | Already clean.                              |
| **vendors**       |      3  |            0  | Clean.                                       |
| **issues**        |      0  |            0  | Inline pattern; only uses ledger dialogs.    |

## Headline opportunities (ranked by impact × ease)

### 1. Reconcile dashboard: collapse the "Hub" pattern → `EASY, HIGH-IMPACT`

The reconcile page currently has separate dialogs for:
- Issues Hub → Issues List → Issues Info (3 nested dialogs)
- Export Hub (just download CSV)
- History Hub → Reconciliation History → Audit Detail → Revert Confirm (4 nested!)
- Statement History

Users open the Hub, then open another dialog from it, then another. Each layer is a separate click + load + close cycle. Worse, the "Hub" dialogs are almost empty — they're just navigation surfaces.

**Recommendation:** Replace each Hub with a popover menu (no dialog at all). Click the toolbar button → small dropdown → pick the action → that action opens its own dialog directly. Removes 1 layer of "are you sure you wanted to open this?"-style friction.

Concrete win: Issues, Export, and History Hubs (3 dialogs) become 3 popovers. Reconcile dialog count drops from 14+ to ~11.

---

### 2. Reconcile "Create Entry" dialog: trim the redundant fields → `EASY, MEDIUM-IMPACT`

The Create Entry dialog shows the user **8 fields** in the preview:

```
Date / Payee / Amount / Method / Suggested method / Category / Suggested category / Ref
```

The "Method" and "Suggested method" are shown as separate rows even when they're the same. Same with "Category" and "Suggested category." This doubles the visual weight of the dialog for no reason in the common case.

**Recommendation:**
- When method == suggested method: hide the suggested row. Only show "Suggested method" when it differs.
- Same for category.
- Result: typical dialog shrinks from 8 lines to 6, eyes scan faster.

Zero behavior change — purely visual compression.

---

### 3. Reconcile Match: skip the dialog for "obvious" matches → `MEDIUM EFFORT, HIGH-IMPACT`

Current match flow (click count to reconcile a single bank tx):
1. Click "Match" on a bank row → opens Match dialog
2. Wait for AI suggestions to load
3. Click the suggested entry (or search if not visible)
4. Click "Match these two"
5. Dialog closes
6. Repeat × N rows

When the AI returns a candidate with **confidence ≥ 95% + exact amount + nearby date**, the user is going to click that one. Always. The dialog is friction.

**Recommendation:** Add a row-level "Auto-match" badge for bank txns where the top AI suggestion is high confidence. Clicking the badge does the match in-place, no dialog. The user still has the "Match" button for the ambiguous cases.

For a user reconciling 50 transactions, this could turn ~250 clicks into ~50 (5× reduction). The full Match dialog stays available for the genuinely ambiguous matches.

**Safety:** Only triggers for very high confidence + exact amount. Lower threshold than the current auto-reconcile flow, but per-row so the user can spot-check.

---

### 4. Closed Periods: too many confirmations → `EASY, MEDIUM-IMPACT`

The closed-periods page has 8 confirmation strings for actions like "close period", "reopen period", "preview", etc. Some of these are appropriate (closing a period is genuinely destructive). But:

- Closing a period that's never been closed: confirm makes sense ✓
- Reopening a period the user just closed in this session: confirm is friction
- Previewing what closing would do: doesn't need confirmation

**Recommendation:** Audit each confirmation and drop the ones that protect against nothing. Keep the truly destructive ones (close, delete). For reopen, show an inline "Reopen" + "Undo" toast pattern.

---

### 5. Issue resolution: inline fix for simple cases → `MEDIUM EFFORT, HIGH-IMPACT`

Currently, fixing an issue opens FixIssueDialog regardless of issue type. The three types differ wildly in fix complexity:

- `MISSING_CATEGORY`: the only thing needed is a category selection
- `DUPLICATE`: needs review of N candidates, pick keep/delete
- `STALE_CHECK`: needs a status change

For `MISSING_CATEGORY` specifically (likely the bulk of issues), an inline category picker on the issue row would let the user fix it without leaving the list. Tab through 20 issues, pick a category each, done — no modal interruption.

**Recommendation:** Render `MISSING_CATEGORY` issues with an inline `<CategoryCombobox>` on the right side of the row. Pressing Enter or selecting saves and removes the row from the list. `DUPLICATE` and `STALE_CHECK` still use the dialog (those are genuinely complex).

---

### 6. Dashboard AI cards: collapse the trio → `EASY, MEDIUM-IMPACT`

The dashboard right column shows three AI cards:
- AI Summary
- Anomalies
- Ask AI

Even when AI hasn't been requested, each shows an empty card with a "Generate insights" button. The empty state eats ~50% of the column.

**Recommendation:** Replace the three cards with one "AI Insights" panel. Collapsed by default with a single "Generate insights" button. When expanded, the three sub-cards appear inside. Removes ~3 stacked empty states from the dashboard.

Bonus: persist the Ask AI chat in sessionStorage so refreshing doesn't lose it (also flagged in the AI audit).

---

### 7. Custom date range: hide the inputs when not used → `EASY, LOW-IMPACT`

When the user picks a date preset (Today, Last 7 days, etc.), the two custom date inputs sit visible and empty in the toolbar. When the user picks "Custom", they appear. Currently both states show the same toolbar width, the inputs just become inert.

**Recommendation:** Hide the custom date inputs entirely unless "Custom" is selected. Toolbar gets quieter for the 95% of users on a preset.

---

### 8. Settings: convert "Edit X" dialogs to inline edit → `MEDIUM EFFORT, MEDIUM-IMPACT`

Settings has 27 dialogs, many of which are "click pencil icon → opens dialog → change one field → click save → close dialog." For single-field changes, this is excessive.

**Recommendation:** For text-only fields (business name, account name, category name, vendor name), use inline-edit: double-click the field → it becomes editable → Enter saves, Escape cancels. Drop the dialog entirely. Standard pattern; users get it instantly.

Keep dialogs for multi-field forms (creating a team member, changing role policies, etc.).

---

### 9. First-time onboarding: no guided path → `LARGER EFFORT, HIGH-IMPACT FOR NEW USERS`

A user who signs up today lands on `/create-business`, creates a business, then is dropped into the dashboard with empty data. From there:

- They need to add a bank account (manual or Plaid) → /settings?tab=accounts
- They need to set up categories → /settings?tab=categories OR import default ones
- They need to invite teammates → /settings?tab=team
- They need to import bank transactions → upload CSV or connect Plaid
- They need to start reconciling → /reconcile

There's no checklist, no "next step" prompt, no tour. The Dashboard's "Next Actions" panel hints at this but only shows after data exists.

**Recommendation:** Add a one-time onboarding checklist that appears as a dismissible card on the Dashboard for new businesses. Five checkboxes:
1. ☑ Created business (auto-checked)
2. ☐ Add or connect an account
3. ☐ Import transactions (or get started with a demo)
4. ☐ Set up categories (or use defaults)
5. ☐ Invite a teammate (optional)

Each item links to where the user does it. Dismisses when complete or when the user clicks "Skip setup."

This is a larger lift but probably the single biggest UX improvement for any new business.

---

### 10. Toolbar action overload on Reconcile → `EASY, MEDIUM-IMPACT`

The reconcile toolbar currently has these buttons in order: Snapshots, Export, Refresh, Auto-Reconcile, History, Issues, account-scope pills, period selector.

For a returning user, only Refresh and Auto-Reconcile are common-use. The rest are "occasional" actions that don't deserve top-level real estate.

**Recommendation:** Move Snapshots, Export, History, Issues behind a single "⋯ More" menu button (same popover pattern as #1 above). Toolbar shows: account scope, period, Refresh, Auto-Reconcile, ⋯ More. Cleaner, easier to scan, common actions stay prominent.

---

## What I'd build first (smallest → largest)

| Order | Item | Effort | User-visible impact |
|---|---|---|---|
| 1 | #2 — Trim duplicate "Suggested" rows in Create Entry | 30 min | Small but visible |
| 2 | #7 — Hide custom date inputs when not "Custom" | 30 min | Polish |
| 3 | #6 — Collapse dashboard AI trio into one panel | 1 hr | Dashboard cleaner |
| 4 | #4 — Drop unnecessary confirmations in Closed Periods | 1 hr | Less friction |
| 5 | #1 — Reconcile Hub → popover menus | 2 hr | Big reconcile decluttering |
| 6 | #10 — Reconcile toolbar "⋯ More" menu | 2 hr | Cleaner top bar |
| 7 | #3 — Reconcile Auto-match badge for high-confidence | 4 hr | **5× click reduction for power users** |
| 8 | #5 — Inline category fix for issues | 4 hr | Issues page transforms |
| 9 | #8 — Inline-edit for settings text fields | 6 hr | Settings drops ~10 dialogs |
| 10 | #9 — First-time onboarding checklist | 8 hr | **Best change for new users** |

Items 1–4 together (~3 hours) would noticeably tighten the app. Items 5–7 (~8 hours) are the bigger structural wins on the most-used page. Items 8–10 are larger projects.

## What this audit deliberately does NOT touch

- Accounting workflows themselves (debits/credits/account math)
- The mutation surface (the optimistic audit already covered that)
- Any AI prompt/behavior (the AI audit covered that)
- Bundle size or render perf (the 2a/2b/2c/2d/4 work covered that)

## Next step

You pick which items to ship. I'd start with #1–4 in one PR (~3 hr total), or any subset you prefer. Each item is independently revertable.
