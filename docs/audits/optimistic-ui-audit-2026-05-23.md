# Optimistic UI Audit — 2026-05-23

This is a **read-only audit**. No code is changed in this PR. The goal: tell you exactly which mutations across the app already feel instant, which could safely be made instant, and which must stay deliberate (no optimism, no rollback risk).

Format for each candidate:

- **Pattern today** — what the user actually sees on click
- **Verdict** — `OPTIMISTIC ALREADY ✓`, `SAFE TO OPTIMIZE`, `DELIBERATELY PESSIMISTIC`, or `DO NOT MAKE OPTIMISTIC`
- **If safe**: the concrete plan (what to setQueryData, what to rollback on error)
- **If not**: why

---

## Headline

**Ledger is already fully optimistic.** All 7 mutations on `/ledger` use TanStack Query's `onMutate` + `setQueryData` + rollback-on-error pattern. The user sees create/update/delete reflect *instantly* in the row list with no spinner; the server call runs in the background; if it fails, the row reverts and an inline banner shows the error.

That means the user's stated mental model — *"UI updates instantly while the backend does its job in the background"* — is already implemented on the most accounting-critical page.

The places it is **not** implemented:
- Reconcile (Match, Mark Adjustment, Snapshots) — "busy-then-refetch" pattern
- Issues (Scan, Fix actions) — pessimistic with invalidation
- Category Review (Apply category) — **deliberately** pessimistic (code comment)
- Settings (every form) — pessimistic
- Vendors (create / update / delete) — pessimistic

This audit recommends **only 4 safe candidates** to add optimism. The rest should stay pessimistic, either by design or by accounting-risk constraint.

---

## Per-page findings

### Ledger — `OPTIMISTIC ALREADY ✓`

| Mutation | Pattern | Status |
|---|---|---|
| `createMut` | `setQueryData([optimistic, ...prev])` w/ correct INCOME/EXPENSE/TRANSFER/ADJUSTMENT sign-flipping. Rolls back from `ctx.previous` on error. | ✓ Optimistic |
| `updateMut` | `setQueryData(prev.map(e => e.id === id ? {...e, ...patch} : e))`. Rollback on error. | ✓ Optimistic |
| `deleteMut` | Marks `deleted_at` optimistically (entry stays in cache for undo). Rollback on error. | ✓ Optimistic |
| `bulkDeleteMut` | Bulk variant of delete. Rolls back ALL on partial failure. | ✓ Optimistic |
| `matchedDeleteMut` | Optimistic delete for matched entries. | ✓ Optimistic |
| `restoreMut` | Optimistic un-delete. Rollback if restore fails. | ✓ Optimistic |
| `hardDeleteMut` | Optimistic permanent removal. Rollback adds the entry back. | ✓ Optimistic |

**Verdict:** No work needed. The pattern here is textbook and well-tested. The sign-flipping logic in `createMut.onMutate` (lines 2138–2156) correctly mirrors backend money math — this is the kind of code that's easy to break by accident, so leave it alone.

---

### Reconcile — Mixed; one safe candidate

#### Match (createMatchGroupsBatch / single + batch) — `DO NOT MAKE OPTIMISTIC`

**Pattern today:** Click "Match" → `BusyButton` shows "Matching…" → server returns the new `match_group_id` → `setMatchGroups(upsert)` patches the local list → `refreshTablesFully` refetches everything → dialog closes.

**Why not optimistic:** A match group is identified by a server-generated `match_group_id`. Without it, the optimistic state has nothing to reference, and if the user reloads mid-flight they'd see a "phantom match" with a fake ID. Match operations also touch reconciliation accounting on the backend (potentially flagging entries as MATCHED, updating bank-tx status) — getting the optimistic version wrong means showing wrong reconciliation totals.

The current "pessimistic but fast" pattern is correct here. The `BusyButton` makes the wait feel intentional. Don't change.

#### Mark Adjustment (`markEntryAdjustment`) — `SAFE TO OPTIMIZE`

**Pattern today:** Click "Mark adjustment" → busy state → server confirms → refetch.

**Why safe:** Adjustment is a *flag* on an entry, not a totals change. The entry's `amount_cents` is unchanged; only an `is_adjustment` boolean and an audit reason are written. Failure rollback is trivial: remove the entry from the `locallyAdjusted` Set.

**Recommended pattern:**
```ts
// onClick
setLocallyAdjusted(prev => new Set(prev).add(adjustEntryId)); // INSTANT
setOpenAdjust(false);

try {
  await markEntryAdjustment({ ... });
  // Already in locallyAdjusted; refetch in background
  void refreshAllDebounced();
} catch (e) {
  // Rollback
  setLocallyAdjusted(prev => {
    const next = new Set(prev);
    next.delete(adjustEntryId);
    return next;
  });
  // Show error inline
  setAdjustError(message);
  setOpenAdjust(true); // reopen dialog with the reason still typed
}
```

**Estimated user-visible improvement:** Dialog closes ~300–500ms sooner. Modest.

#### Snapshots (`createReconcileSnapshot`) — `DO NOT MAKE OPTIMISTIC`

**Why not:** A snapshot is a server-side immutable record of reconciliation state at a point in time. The snapshot ID, hash, and file URL all come from the server. There's nothing to display optimistically.

#### Plaid Sync / Bank Tx Import — `DO NOT MAKE OPTIMISTIC`

**Why not:** Server polls a third party (Plaid). Result is non-deterministic. Must wait.

---

### Issues — All pessimistic; one safe candidate

#### Scan (`POST /issues/scan`) — `DO NOT MAKE OPTIMISTIC`

**Why not:** Server runs detection logic and creates new issue rows. The output is fundamentally unpredictable client-side.

#### Dismiss / Resolve issue — `SAFE TO OPTIMIZE`

If the issues list has a per-row "dismiss" or "mark resolved" action, that's a simple flag update. Same pattern as Mark Adjustment above: setQueryData to remove the issue from the list, rollback on error.

> **Note:** I didn't verify whether this action exists today in the issues page — verify in code before implementing.

---

### Category Review — `DELIBERATELY PESSIMISTIC` (leave alone)

**Direct quote from `category-review/page-client.tsx` line 889:**
> *"Patch only after the API succeeds so single-row applies feel immediate without rollback risk."*

The author deliberately chose pessimistic for category assignment because:
1. Categories drive P&L / cash-flow / dashboard totals
2. A rolled-back category change is visually confusing (number jumps, then jumps back)
3. Bulk apply across many entries makes rollback complexity high

**Verdict:** Respect the original engineering decision. Don't optimize.

---

### Vendors — One safe candidate

#### Create vendor — `SAFE TO OPTIMIZE`

**Pattern today:** Form submit → busy → server creates row with ID → list refetches → dialog closes.

**Recommended pattern:**
```ts
const tempId = `tmp-${Date.now()}`;
const optimistic = { id: tempId, name, type, ... };
setQueryData(vendorsKey, prev => [optimistic, ...prev]);

try {
  const real = await createVendor({ ... });
  // Replace temp with real
  setQueryData(vendorsKey, prev =>
    prev.map(v => v.id === tempId ? real : v)
  );
} catch (e) {
  // Remove the optimistic row
  setQueryData(vendorsKey, prev => prev.filter(v => v.id !== tempId));
  // Reopen form with the typed values still present
}
```

#### Update vendor (rename, change type) — `SAFE TO OPTIMIZE`

Simple field change. Same pattern as ledger's updateMut.

#### Delete vendor — `SAFE TO OPTIMIZE` *with caveat*

Simple to optimize, but: deleting a vendor that has linked AP bills or entries may fail server-side with a constraint error. Rollback must add the vendor back AND show a clear "Can't delete: still has X transactions" message. Worth a 60-second discussion before implementing.

---

### Settings — All pessimistic; mixed candidates

Settings has ~19 mutation sites (forms for business name, account rename, team invite, role change, category create/delete, theme prefs, etc).

**Generally `SAFE TO OPTIMIZE`:**
- Business name change (display-only field)
- Account name change
- Theme preference (already optimistic via `useThemePreference`)
- Bookkeeping prefs

**`DO NOT MAKE OPTIMISTIC`:**
- Reset Business (destructive — needs confirmation step, not speed)
- Delete Business (same)
- Create / delete account (affects ledger / reconcile globally)
- Add/remove team member (auth state must be authoritative)
- Plaid connect/disconnect (network-bound, server confirms)

**Verdict:** Low priority. These are settings pages — users tolerate a short wait. Only do these if the user complains.

---

## What This Means In Practice

If you want to implement optimistic UI on the candidates above, I'd ship them in this order, each as its own PR:

1. **Reconcile: Mark Adjustment** — smallest scope, clearest rollback. ~30 min PR.
2. **Vendors: Create vendor** — uses the `tempId` pattern that's well-tested elsewhere. ~45 min PR.
3. **Vendors: Update vendor** — same as ledger's updateMut. ~30 min PR.
4. **Issues: Dismiss / resolve** — only if the action exists. Need to verify first.
5. **Vendors: Delete vendor** — needs error UX for constraint failures. ~1 hour PR.

I would **not** touch:
- Ledger (already optimistic — re-engineering would be risk for no gain)
- Category Review (deliberate design decision)
- Reconcile Match / Snapshots (server-generated IDs)
- Settings destructive actions (reset/delete)
- Auth-state mutations

## Safety Rules for Any Optimistic Implementation

These should be invariants for any new optimistic mutation:

1. **Cancel in-flight queries** with the same key before applying optimistic state (prevents a stale refetch overwriting your optimistic write).
2. **Capture `previous` in `onMutate`** and return it from the function. `onError` reads `ctx.previous` to roll back.
3. **Never modify cents** optimistically unless you can prove the sign + magnitude exactly match what the server will compute. Ledger `createMut.onMutate` does this correctly — copy that pattern.
4. **Rollback is mandatory.** Every optimistic write needs an `onError` rollback. No exceptions.
5. **Surface the error inline**, not just toast. The user needs to know their action didn't actually stick.
6. **Do not optimistically update derived totals** (P&L, cash balance, runway). Those should always recompute from authoritative cache data — never set them directly.

## Next Step

Tell me which candidate to start with (or none) and I'll branch + implement + PR.
