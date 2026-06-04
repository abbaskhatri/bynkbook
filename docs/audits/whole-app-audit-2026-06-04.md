# Whole-app audit — 2026-06-04

Scope: dead code, hardcoding, broken links, wiring, dead features, AI quality, API connectivity, code cleanliness. Audited both `bynkbook-web/` (frontend) and `infra-sst/packages/functions/` (backend).

## Headline

The app is in good shape after the recent audit cycle. TypeScript is clean on both sides (0 errors), there are no TODO/FIXME markers, the AI surface is well-wired, and the money math is BigInt throughout. Findings below are real but mostly cleanup-grade — only one of them (closed-periods hooks) is a latent React bug, and three are user-visible.

## Findings, ranked

### 1. Closed-periods page calls hooks inside a callback — fragile React pattern (HIGH)

`bynkbook-web/src/app/(app)/closed-periods/page-client.tsx` lines 232–268 wrap a `useState`/`useMemo` cluster inside an IIFE that runs as a child render:

```tsx
<div className="rounded-md border ...">
  {(() => {
    ...
    const [mode, setMode] = useState<RangeMode>("MONTH");
    const [monthMode, setMonthMode] = useState<string>("");
    // ...10 hook calls inside the IIFE
  })()}
</div>
```

ESLint flags 10 `react-hooks/rules-of-hooks` violations here. It happens to work today because the IIFE runs unconditionally at the same render position, but this is exactly the pattern that breaks the first time someone wraps it in a conditional or extracts it to a sibling. **Fix:** lift those hooks into the parent component, or extract the IIFE into a proper child component (`<CloseThroughControl />`).

### 2. Privacy and Terms links 404 (HIGH — user-visible)

`bynkbook-web/src/components/app/app-shell-inner.tsx` lines 920–936 render `<Link href="/privacy">` and `<Link href="/terms">` in the user menu, but neither route exists under `src/app/`. Any user opening the menu and clicking either link gets Next.js's 404 page. **Fix options:** (a) create the two pages even if minimal, (b) point them at external URLs, or (c) remove the menu items until pages exist.

### 3. Two pages bypass `apiFetch` with their own fetch + auth (HIGH)

`bynkbook-web/src/app/(app)/issues/page-client.tsx` line 209 and `bynkbook-web/src/app/(app)/ledger/page-client.tsx` line 1887 read `process.env.NEXT_PUBLIC_API_URL || NEXT_PUBLIC_API_BASE_URL || NEXT_PUBLIC_API_ENDPOINT`, fetch a fresh token via `fetchAuthSession()`, and build `fetch()` directly. This bypasses every improvement in `lib/api/client.ts`:

- 60s token cache + in-flight coalescing
- Centralized `CLOSED_PERIOD` handling
- Performance metrics tagging
- Consistent error shape

It also introduces an env-var fallback chain that the rest of the app doesn't use, so deployment misconfig could leave these two pages working while the rest of the app breaks (or vice versa).

**Fix:** convert both call sites to `apiFetch(...)`. Drop the local `NEXT_PUBLIC_API_BASE_URL`/`_ENDPOINT` references — standardize on `NEXT_PUBLIC_API_URL`.

### 4. Duplicate error helper (`src/lib/errors.ts` vs `src/lib/errors/app-error.ts`) (MEDIUM)

- `src/lib/errors.ts` exports `userFacingErrorMessage()` — imported by 1 file (settings).
- `src/lib/errors/app-error.ts` exports `extractHttpStatus()` + `appErrorMessageOrNull()` — imported by 10 files.

The old `errors.ts` is a holdover. **Fix:** migrate settings to `appErrorMessageOrNull()` and delete `src/lib/errors.ts`.

### 5. `infra-sst/bookkeeping-app/` shadow directory (MEDIUM)

32 KB stale copy of the backend (`sst.config.ts`, `package.json`, a stub `todo` handler). Created when `infra-sst` was flattened from a submodule (commit `ae28c79`). It's not referenced by any deploy: the live `sst.config.ts` lives at `infra-sst/sst.config.ts` and points to `infra-sst/packages/functions/...`. The shadow path only ever appears in grep results for `bookkeeping-app` itself.

**Fix:** delete `infra-sst/bookkeeping-app/` entirely.

### 6. Dead backend route `POST /v1/ai/suggest-category` (MEDIUM)

`infra-sst/sst.config.ts` line 607 registers `POST /v1/ai/suggest-category` against `aiHandler`. Zero frontend callers. The new path used everywhere is `POST /v1/businesses/{businessId}/ai/category-suggestions` (line 599, `aiCategorySuggestionsHandler`).

**Fix:** confirm with you, then remove the route registration and the corresponding handler branch in `ai.ts` if nothing else dispatches to it. No client impact.

### 7. Four hardcoded color tokens left in in-app pages (LOW — dark-mode regression)

Spotted in:
- `ledger/page-client.tsx:5370` — `border-amber-200 bg-amber-50 text-amber-900` (delete-confirm banner)
- `ledger/page-client.tsx:5383` — `text-red-700` / `text-emerald-700` (signed amount in same dialog)
- `ledger/page-client.tsx:5430` — `border-red-200 bg-red-50 text-red-700` (error banner)
- `settings/category-migration/page-client.tsx:304` — `text-red-600` (error alert)

All of these are in dialogs / inline error banners that don't repaint when the user flips themes. The rest of the app uses `bb-status-warning-*`, `bb-amount-negative`, `bb-status-error-*` tokens. **Fix:** small token swap, no behavior change.

### 8. Stray `console.log` in production code (LOW)

- `bynkbook-web/src/lib/perf/metrics.ts:23` — gated by a debug flag, intentional, **keep**.
- `bynkbook-web/src/app/(app)/ledger/page-client.tsx:252` — gated by a debug flag too, **keep**.
- `infra-sst/packages/functions/src/events/todo-created.ts:5` — `console.log("Todo created", evt);` — looks like a leftover diagnostic. **Fix:** drop or guard.

### 9. 142 lint warnings (LOW, but cleanup worthwhile)

Breakdown:
| Rule | Count | Notes |
|---|---|---|
| `@typescript-eslint/no-unused-vars` | 64 | Mechanically fixable. Mostly dead destructures + unused imports left after refactors. |
| `react-hooks/exhaustive-deps` | 51 | Each needs eyeballing — some are intentional, a handful are real bugs waiting to bite. |
| `react-hooks/rules-of-hooks` | 10 | All 10 from finding #1 (closed-periods). |
| `react/no-unescaped-entities` | 8 | Cosmetic. Just escape the apostrophes. |
| `react-hooks/set-state-in-effect` | 6 | Real review-worthy: setting state during render via effect can cause loops. |
| `@typescript-eslint/ban-ts-comment` | 2 | Probably need legit suppression. |

**Recommendation:** ship a "lint sweep" PR that knocks out unused-vars + unescaped-entities (~72 mechanical), then a separate PR triaging the 51 exhaustive-deps and 6 set-state-in-effect by hand.

### 10. Heavy page-client megafiles (LOW — architectural)

Top 8 source files account for ~28k of 50k lines:

| File | Lines |
|---|---|
| `reconcile/page-client.tsx` | 7,348 |
| `ledger/page-client.tsx` | 5,785 |
| `settings/page-client.tsx` | 3,881 |
| `category-review/page-client.tsx` | 2,761 |
| `vendors/[vendorId]/page-client.tsx` | 2,686 |
| `dashboard/page-client.tsx` | 2,071 |
| `reports/page-client.tsx` | 1,731 |
| `issues/page-client.tsx` | 1,136 |

Nothing's broken because of this — but every navigation between them ships a lot of JS, and any future engineer reading them will struggle. Worth a multi-PR refactor over time: extract per-feature blocks (dialogs, tables, side panels) into their own components.

## What's verifiably GOOD

- **TypeScript:** 0 errors across `bynkbook-web` and `infra-sst/packages/functions`.
- **Lint:** 0 errors, only warnings.
- **No TODO/FIXME debt** anywhere in the codebase.
- **Money math:** consolidated in `src/lib/money.ts`, BigInt throughout, no float arithmetic.
- **AI surface wiring:** every frontend AI endpoint (`/v1/ai/anomalies`, `/chat`, `/explain-entry`, `/explain-report`, `/merchant-normalize`, `/suggest-reconcile-bank`, `/suggest-reconcile-entry`) has a matching SST route. Only stray is finding #6 above.
- **API client centralization:** `apiFetch` already handles token caching, CLOSED_PERIOD UX, and metrics. Two stragglers (finding #3) are the only consumers not using it.
- **Hardcoded URLs:** only Plaid's CDN script, which is correct.
- **Hardcoded colors:** down from ~500 (per earlier audit) to 4. Substantially clean.
- **Backend tests** exist for the critical correctness paths (entries pagination, entries delete safety, AP, businesses, closed periods, issues scan, ledger summary, match-groups revert, reports, role policies, team, uploads).
- **Routes inventory:** every nav route resolves to a real page, except `/privacy` and `/terms` (finding #2).
- **Design-token coverage:** the bulk of the app uses the `bb-*` CSS variables, so dark-mode is largely correct.

## Suggested PR list (prioritized)

1. **PR: closed-periods hook refactor** — fix finding #1. Lift the IIFE into a `<CloseThroughControl />` component. This is the only finding with real React risk.
2. **PR: Privacy / Terms pages** — fix finding #2. Quickest path: minimal placeholder pages with a "Coming soon — contact support" message, or external links.
3. **PR: unify API base URL + apiFetch** — fix finding #3. Convert issues and ledger to `apiFetch`, drop fallback env vars.
4. **PR: cleanup sweep** — combine findings #4 (delete `errors.ts`), #5 (delete `bookkeeping-app/`), #8 (drop console.log), #7 (4 color token swaps).
5. **PR: lint sweep** — finding #9 mechanical fixes (unused-vars + unescaped-entities).
6. **PR: triage exhaustive-deps + set-state-in-effect** — finding #9 manual review.
7. **PR (optional, requires your sign-off):** remove dead backend route `POST /v1/ai/suggest-category` — finding #6.
8. **Refactor backlog:** finding #10 megafile splits, no rush.

Pick any subset and I'll ship them. PRs 1–4 are the highest-value bundle; PR 5 is satisfying free cleanup; PR 7 needs your call because it touches deployed infra.
