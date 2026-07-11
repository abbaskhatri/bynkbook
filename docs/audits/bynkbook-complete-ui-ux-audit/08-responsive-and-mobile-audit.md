# Responsive and Mobile Audit

## Browser viewport matrix

| Viewport | Public landing | Login/signup | Horizontal overflow | Notes |
|---|---|---|---|---|
| 320×568 | Verified | Auth layout structurally responsive | None on landing | Very small baseline |
| 390×844 | Verified + screenshots | Verified + screenshots | None | Landing header Sign in is 76×32 |
| 768×1024 | Verified | Source/browser responsive | None on landing | Tablet breakpoint |
| 1440×900/1000 | Verified + screenshot | Verified | None | Full marketing layout |

Public production-mode rendering produced no console errors. Authenticated current-build viewport verification was blocked when the synthetic QA refresh returned HTTP 400.

## Static authenticated evidence

- Main app collapses desktop sidebar and provides a 4.75rem bottom bar with Home, Ledger, Reconcile, Issues and More.
- Mobile drawer includes global search and full navigation.
- Dedicated `/mobile/*` pages cap content at 480px and provide a separate five-item bottom bar.
- AppDialog becomes a bottom sheet on small screens; side panels become almost full-width.
- Tables use min-width and horizontal containers; this avoids column collapse but can create high horizontal-scroll burden.

## Findings

- Two competing mobile architectures create inconsistent labels and task availability.
- Numerous 28–36px controls are below a 44px touch target; the public landing defect was measured directly.
- Dialog focus/background defects are especially harmful on mobile because overlays occupy nearly the whole viewport.
- Actual zoom/reflow and authenticated tablet workflows remain unverified.

## Recommendation

Select one mobile architecture. Prefer responsive core pages plus task-focused responsive record cards for high-frequency queues; keep receipt/invoice capture as focused flows. Maintain safe-area padding, 44px targets, stable bottom navigation and no hidden desktop-only critical action.
