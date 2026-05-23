# AI Quality Audit — 2026-05-23

This is a **read-only audit**. No code is changed in this PR. The goal: tell you, for every AI feature in the app, whether it's smart enough today, where it falls short, and what would be a low-risk improvement.

## TL;DR

The AI architecture is **better than I expected**. Specifically:

- **Tiered confidence is real.** Category suggestions come back with `tier` (SAFE_DETERMINISTIC, STRONG_SUGGESTION, ALTERNATE, REVIEW_BUCKET) and `source` (VENDOR_DEFAULT, MEMORY, HEURISTIC, AI). The UI uses these to gate auto-apply vs. needs-review correctly.
- **AI is opt-in for cost-sensitive paths.** Ledger calls `getCategorySuggestions` with `includeAiFallback: false` — it only ships the deterministic suggestions for free, never burns AI tokens unless explicitly requested.
- **Rate-limit UX is consistent.** Every AI call site catches 429 and surfaces a friendly message ("AI quota reached. Try again in a little while.") instead of a raw error.
- **Dashboard AI is gated behind a button.** No background AI runs — the user explicitly clicks "Generate insights." This is the right default for cost control.

The places I'd improve:

- **Three near-duplicate functions** (`getCategorySuggestions`, `aiSuggestCategory`, `applyCategoryBatch`) cover the same surface with slightly different shapes. Consolidating would reduce maintenance.
- **Cache key thrash** — anomaly + narrative queries re-fetch when the user changes period mode, but the period mode is part of the key even when the resulting `from`/`to` are identical. Small win.
- **Confidence display in reconcile** — `aiSuggestReconcileBank` returns confidence per candidate but the UI doesn't visually rank them; they're ordered by AI score but the score isn't shown explicitly to the user. Adding "AI: 87% match" inline would let users trust or override more confidently.
- **AI for issues page** — there's no AI surface on `/issues` today, even though issue triage (which to fix first, which look like real problems vs noise) is exactly where AI helps most. Worth considering an `aiTriageIssues` endpoint.

---

## AI Surface Inventory

13 functions in `lib/api/ai.ts`. Grouped by what they do for the user:

### Search & Discovery

| Function | Used by | What it does |
|---|---|---|
| `queryGlobalSearch` | `components/app/global-search.tsx` | Top-bar Cmd-K search. NLP-friendly query interpretation over entries + bank txns. |

### Category Intelligence (the big one)

| Function | Used by | What it does |
|---|---|---|
| `getCategorySuggestions` | ledger, category-review | Batch deterministic + AI suggestions. Returns tier + source + confidence per item. Has `includeAiFallback` flag for cost control. |
| `aiSuggestCategory` | (imported in ledger, not actively called) | Single-entry variant. Largely redundant with above. |
| `applyCategoryBatch` | category-review | Batch apply — not actually AI; just a backend write that records the suggested_category_id link. |

### Reconciliation Intelligence

| Function | Used by | What it does |
|---|---|---|
| `aiSuggestReconcileBank` | reconcile | Given a bank tx + candidate ledger entries, suggests which entry to match. |
| `aiSuggestReconcileEntry` | reconcile | Inverse direction: given an entry + candidate bank txns. |

### Narrative & Anomalies

| Function | Used by | What it does |
|---|---|---|
| `aiExplainEntry` | ledger | Per-entry "why is this categorized this way" explanation. |
| `aiExplainReport` | dashboard | Multi-paragraph narrative summary of the period. |
| `aiAnomalies` | dashboard | Statistical anomaly detection on the period's transactions. |

### Conversation

| Function | Used by | What it does |
|---|---|---|
| `aiChat` | (defined but not actively used; superseded by `aiChatAggregates`) | Generic Q&A over business data. |
| `aiChatAggregates` | dashboard | "Ask AI" widget — uses pre-computed dashboard aggregates, not raw ledger. |

### Other

| Function | Used by | What it does |
|---|---|---|
| `aiMerchantNormalize` | ledger | Clean up merchant name (e.g., "AMZN MKTPL US*1A2B3C4D5" → "Amazon"). |
| `getDashboardInsights` | (defined but not actively used) | Server-side deterministic insights (not LLM). |

---

## Per-Feature Quality Assessment

### Category Suggestions on Ledger — `STRONG ✓`

**Pattern today:** Click "Suggest" → calls `getCategorySuggestions` with batch of visible entries, `includeAiFallback: false`. Backend returns deterministic suggestions only (vendor-default + memory + heuristic). Each suggestion includes confidence, tier, source. Top suggestion per entry shown as a one-click pill.

**Strengths:**
- Pre-computed tier means UI can present "Strong" vs "Review needed" without ambiguity
- No AI tokens burned for users who don't request them
- Caching via local `ledgerSugTopByEntryId` state — doesn't refetch on re-render

**Weaknesses:**
- The "AI suggestions are unavailable right now" message fires for 429, network, AND server errors — user can't tell if it's a temporary network blip vs hitting the daily AI cap
- No way to manually trigger AI fallback when deterministic suggestions are weak (would need `includeAiFallback: true` toggle in UI)

**Recommendation:** Add a "Suggest with AI" secondary action when deterministic confidence < 60%. Doesn't replace the current button — it's a fallback for the cases where memory + heuristics aren't enough.

---

### Category Review (the bulk-categorization flow) — `STRONG ✓`

**Pattern today:** Page lists uncategorized entries. Suggestions are shown grouped by tier. User selects suggestions to apply; "Apply" mutation hits `applyCategoryBatch`.

**Strengths:**
- The four-tier model (SAFE_DETERMINISTIC, STRONG_SUGGESTION, ALTERNATE, REVIEW_BUCKET) is exactly the right abstraction
- `categorySuggestionRequiresReview()` correctly gates protected-class categories (e.g., owner draws) behind explicit confirmation
- Deliberately pessimistic (per the audit comment) — applies AFTER the API succeeds, no rollback risk

**Weaknesses:**
- The page is 114 KB / 2,584 lines — could benefit from the same helper-extraction pattern as PR #141/#142
- No "explain why this category was suggested" link inline — user has to trust the source label alone

**Recommendation:** Add an inline "Why?" link on STRONG_SUGGESTION rows. Onclick → quick popover with the reason string the backend already returns (`suggestion.reason`).

---

### Reconcile Match Suggestions — `MEDIUM`

**Pattern today:** In the match dialog, `aiSuggestReconcileBank` returns candidates with confidence. The UI shows them ranked but doesn't display the confidence number.

**Strengths:**
- Backend computes deterministic signals (amount_delta_cents, date_delta_days, text_similarity) AND AI confidence
- The `matchSignalChips` helper shows "Exact amount", "Near date", "Similar payee" badges — readable

**Weaknesses:**
- The confidence number (0–1) is computed but discarded by the UI in the candidate list
- "Review needed" chip appears when confidence < 0.75 but the actual number isn't surfaced — user can't tell 0.50 from 0.74
- No batch suggestion path — each match dialog opens, then suggestion fetches per click. For users reconciling 50+ bank txns this is slow.

**Recommendation:**
1. Show "AI: 87% match" inline on each candidate. The number already exists.
2. Add a batch-suggest endpoint that pre-fetches matches for the visible bank txns when reconcile page loads. Currently we wait until the user clicks "Match" to ask AI.

---

### Dashboard AI (Summary / Anomalies / Ask AI) — `STRONG ✓ but feature-bloated`

**Pattern today:** Three AI cards on the right side of the dashboard:
1. **AI Summary** — narrative paragraph
2. **Anomalies** — list of unusual transactions
3. **Ask AI** — free-form chat box

All three are gated behind a single "Generate insights" button. 429 handling is centralized via `dashboardAiMessage()`.

**Strengths:**
- Opt-in design: no AI tokens until the user clicks
- Same period scope feeds all three (consistent data)
- Chat uses `aiChatAggregates` with pre-computed dashboard data only, not raw ledger — prevents the AI from making up entry-level claims

**Weaknesses:**
- Three cards consume ~50% of the dashboard right column even when empty (just showing "Generate insights" prompts)
- "Ask AI" widget has 6 separate state vars (`chatOpen`, `chatQ`, `chatMsgs`, `chatBusy`, `chatErr`, `chatAggregates`) — should be its own component
- No conversation persistence — refreshing the page clears the chat history
- Cache thrash: query key includes `range.mode` and `range.from`/`range.to`, so switching from `LAST_3_MONTHS` to a CUSTOM range with the same dates causes a refetch

**Recommendation:**
1. **Collapse all three into one card** that expands when activated (UI improvement, covered in the Mobile/UX audit next)
2. **Persist chat history** in `sessionStorage` keyed by businessId + period (5-min TTL) so the user doesn't lose their conversation on accidental refresh
3. **Fix cache key**: omit `range.mode` from query keys when it's not adding information beyond `from`/`to`

---

### Anomaly Detection — `STRONG ✓`

**Pattern today:** `aiAnomalies` returns up to 5 anomalies with `title`, `reason`, `baseline.median_abs_cents`, `baseline.sample_size`, `confidence`.

**Strengths:**
- Statistical baseline shown to user — they can judge whether the sample is meaningful
- Confidence rounded to percent — easy to read
- Top 5 cap prevents overwhelming the user

**Weaknesses:**
- The "baseline median: 4523¢" display is in raw cents — should be formatted as `$45.23`
- No "dismiss this anomaly" action — if the AI flags something that's normal-for-this-business, the user has no feedback loop
- Clicking an anomaly doesn't navigate to the underlying entry

**Recommendation:**
1. Format baseline cents using existing `formatUsdFromCents`
2. Add "View entry" link → `/ledger?businessId=X&accountId=Y&highlight=entryId`
3. Optional: "Dismiss" action that POSTs to a `/v1/ai/anomalies/dismiss` endpoint (server-side) so the same entry stops being flagged

---

### Merchant Normalize — `MEDIUM`

**Pattern today:** Ledger calls `aiMerchantNormalize` to suggest a clean payee name. Results cached in `merchantCacheRef`.

**Strengths:**
- Local cache prevents duplicate calls for the same entry
- Confidence + reason returned and could be shown

**Weaknesses:**
- `merchantBusyId` and `merchantErrId` are state vars but never read by JSX — looks like the UI got partly built and then abandoned (TypeScript lint flags them as unused)
- No batch endpoint — each row hits AI individually if the user clicks "Normalize" multiple times

**Recommendation:** Either remove the unused state (cleanup) and ship merchant normalize as a fully integrated feature, or deprecate the endpoint. Currently it's in a half-built state.

---

### Issues Page AI — `MISSING`

**Pattern today:** No AI surface. Users scan for issues and fix them one-by-one.

**Opportunity:** Issue triage is the kind of work where AI shines — given 200 issues, which are duplicates of a real merchant pattern vs. one-off noise? Which look most urgent (large amount, recent date)?

**Recommendation (forward-looking):**
1. New endpoint: `aiTriageIssues({ businessId, accountId })` → returns issue IDs sorted by suggested-fix priority + grouped by likely-same-root-cause
2. UI: Top of issues page becomes "AI suggests fixing these 12 first (3 groups)"
3. Defer this until backend has bandwidth — UI work is straightforward once endpoint exists

---

## Cross-Cutting Observations

### Error UX consistency — `GOOD`

Each call site uses one of three helper functions to map errors to user-facing strings:
- `aiUiMessage()` in reconcile/helpers
- `aiFriendlyMessage()` in ledger
- `dashboardAiMessage()` in dashboard

They're slightly different versions of the same logic. **Recommendation:** Consolidate into one `aiUserMessage()` in `lib/errors/`. Three near-identical implementations is two too many.

### Cost control — `STRONG ✓`

- AI fallback is opt-in (`includeAiFallback: false` is the default for ledger)
- Dashboard AI gated behind explicit button click
- 429 quota errors get a clear "try later" message
- No background AI calls (e.g., no auto-suggest on page load)

This is unusually well-disciplined. Don't change.

### Caching — `MEDIUM`

What's cached:
- ✓ Merchant normalize (per-entry, in-memory ref)
- ✓ Dashboard AI queries (TanStack 30s staleTime, 5min gcTime)
- ✗ Reconcile suggestions (re-fetched every time the match dialog opens)
- ✗ Category suggestions (re-fetched on every "Suggest" click)

**Recommendation:** Add `staleTime: 60_000` to category suggestion queries if you convert them to `useQuery`. They don't change between renders.

### Test coverage of AI flows — `UNKNOWN`

I see `.qa/category-suggestions-probe.json` and `.qa/category-suggestions-probe.mjs` — there are some integration probes. I didn't run them but their existence is reassuring. **Recommendation:** Make sure these run in CI on the AI changes you ship.

---

## What I'd Build Next (if asked)

In rough priority order, smallest → biggest:

1. **Format anomaly baseline as dollars** (5 min). Tiny but visible quality fix.
2. **Show confidence number in reconcile match candidates** (15 min). The data is already there.
3. **Add "Why?" link to category review STRONG suggestions** (30 min). Improves trust.
4. **Persist Ask AI chat in sessionStorage** (30 min). Removes a real UX annoyance.
5. **Consolidate the three error-message helpers** (45 min). Reduces drift risk.
6. **Add "View entry" link to anomalies** (1 hr). Bridges insight → action.
7. **Remove unused merchant-normalize state** OR finish the feature (decision needed).
8. **Pre-fetch reconcile suggestions on page load** (2 hr — needs new endpoint or batching).

I would **not** touch:
- The tier / source / confidence schema (it's working)
- The opt-in AI fallback default (cost control is good)
- The pessimistic apply pattern in category-review (deliberate)

## Next Step

Pick one or more of items 1–6 and I'll branch + implement. None of them touch accounting; all are UX polish + small backend interactions.
