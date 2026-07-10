# Frontend audit

## Framework and entry points

The frontend is Next.js 16.1.1 App Router with React 19.2.3 and TypeScript. `src/app/layout.tsx` installs providers and theme bootstrap; `src/app/page.tsx` is the public landing page; `(auth)` contains public/account flows; `(app)/layout.tsx` wraps authenticated pages in AppShell. TanStack Query is the main server-state layer. Feature modules under `src/lib/api` use a shared `apiFetch` client.

## Page-by-page assessment

| Route(s) | Purpose/backend connection | Loading/empty/error behavior | Result |
|---|---|---|---|
| `/` | Marketing and auth entry; no business data | auth-check skeleton; static product scene | Works; hardcoded named demo (`015`) |
| `/login`, `/signup` | Cognito email and Google auth | disabled submit until input; inline errors | Render verified; submission not tested |
| `/confirm-signup`, `/forgot-password`, `/reset-password` | Cognito confirmation/recovery | guided forms and inline errors | Render verified; submission not tested |
| `/oauth-callback` | Completes Amplify hosted UI and routes to stored/sanitized next path | callback progress/error | Code-traced only |
| `/accept-invite` | Calls team invite acceptance endpoint | progress/error/success routing | Code-traced only |
| `/create-business` | Calls business create API after auth; redirects existing businesses | skeleton, error, form | Signed-out redirect verified |
| `/privacy`, `/terms` | Public legal copy | static | Technically works; content is placeholder (`002`) |
| `/dashboard` | attention, reports, AI insights | skeletons, empty cards, retry paths | Signed-out protection verified; authenticated unknown |
| `/ledger` | entries, categories, transfers, issues, matches, exports | pagination, retained data, dialogs, structured errors | Code-traced; large module (`019`), CSV risk (`009`) |
| `/reconcile` | bank/entry matching, history, snapshots, Plaid, AI | pagination/virtualization, extensive states | Code-traced; large module and CSV risk |
| `/issues` | scan/filter/resolve/bulk fixes | skeleton/filter empty/error states | Code-traced |
| `/category-review` | category suggestions and safe apply | review queue/loading/error | Code-traced |
| `/closed-periods` | preview/close/reopen and activity | skeleton/recent action/error | Code-traced |
| `/planning` | budgets and goals | month/category empty and edit states | Code-traced |
| `/reports` | P&L, cash flow, accounts, AP aging, categories | chart/table skeleton and empty states | Code-traced |
| `/vendors`, `/vendors/[vendorId]` | vendor CRUD, bills, payments, statement | skeleton/empty/dialog/error | Code-traced; backend statement broken (`001`) |
| `/settings` | profile, accounts, Plaid, team, policies, preferences, activity, destructive owner actions | very extensive loading/confirm/error UI | Code-traced; policy incomplete (`006`,`007`) |
| `/settings/category-migration` | preview/apply category migration | preview/loading/error | Code-traced |
| `/accounts` | legacy redirect to Settings accounts tab | redirect only | Expected compatibility route |
| `/dev/dialogs` | internal dialog gallery | static demo | Ships in production (`018`) |
| `/mobile` and queues | compact attention/AP/activity/review views | mobile cards, skeletons, empty/error | Code-traced |
| `/mobile/invoice`, `/mobile/receipt` | camera/file upload to review | type/size validation, queue/progress/failure | Code-traced; no real upload |

## Routing and navigation

AppShell navigation targets all resolve in the production build. The build emitted 34 static pages (including not-found) and one dynamic vendor-detail route. Signed-out navigation to `/dashboard` correctly redirected to login with a same-origin next path. The public landing uses buttons with router actions rather than anchors for several destinations; this works but reduces conventional link semantics and contributes to small touch targets.

## API and authentication state

`apiFetch` provides a coherent single base URL, token coalescing/cache, 401 refresh, timeouts, no-store fetches, and structured error mappings. The client prefers Cognito ID token because the API authorizer uses app-client audience. `sanitizeAuthNext` rejects external origins. The live production chunk contains the working `cpjh7t19u1` API, while the tracked `.env.production` would not produce the same result (`011`).

Session policy uses localStorage timestamps and Amplify sign-out. Default idle and maximum age are both seven days unless overridden by public environment variables. The landing page's hardcoded “12h Session control” marketing figure is therefore configuration-dependent and not proven by repository defaults.

## Responsive behavior

At 1280×720 and 390×844, the public landing and account pages had no horizontal overflow. Major form buttons were 44px high. Several secondary text actions measured 16px high (`016`). Authenticated responsive pages could not be visually checked without a test account. Mobile-specific routes and components are substantial rather than simple redirects.

## Accessibility

Positive evidence: HTML language is English, visible forms use IDs/labels in source, many icon buttons have aria labels, keyboard-aware dialogs use shared primitives, and no broken images were observed. Gaps: small touch targets on public text actions; no automated axe/Lighthouse run; authenticated keyboard/focus/contrast behavior unverified; the landing image has empty alt because it is decorative, which is appropriate.

## Error/loading/empty states

Skeletons are widespread. `apiFetch` turns closed-period, matched-delete, Plaid, timeout, and auth failures into user-oriented exceptions. AppShell has explicit auth redirect, no-workspace, and workspace-load-error screens. Large pages include their own inline errors and empty states. Browser console produced no warnings/errors on tested public routes.

## Security and content

- No unescaped business fields were found in the ledger print HTML; `escapeHtml` is applied.
- The inline theme bootstrap uses fixed source text, not user input.
- CSV exporters do not protect formula prefixes (`009`).
- Public legal copy is placeholder (`002`).
- Baseline browser security headers are absent (`010`).
- No obvious committed private key/API key/database URL was found by common-pattern scan.

## Performance and bundle observations

Local build produced 79 static chunk/map/CSS files totaling 4,033,729 uncompressed bytes; two JavaScript chunks were about 400 KB. This is not a per-route transferred-size measurement. Next compiled in 4.4 seconds. Reconcile, ledger, and settings remain unusually large source modules (`019`). React Query caching, dynamic global search, pagination, virtualization, and conditional dialog rendering are positive controls. No authenticated production performance trace was captured.

## Frontend quality result

- `npx tsc --noEmit`: pass.
- `npm run lint`: pass with no emitted warnings.
- `npm run build`: pass; 34 static pages and one dynamic route.
- Frontend automated tests: none configured (`020`).
- Dependency audit: fail due to 8 advisories (`003`).
