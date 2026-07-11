# Founder UI Verification Guide

## Public launch surface

- Open `/` at desktop and phone widths.
- Confirm the product purpose and calls to action are clear, no horizontal scrolling exists, and all claims are supportable.
- Open `/privacy` and `/terms`; no placeholder instruction may remain before launch.
- Warning signs: “launch-ready” without approved legal copy, tiny header actions, unsupported numeric claims.

## Authentication

- Test signup, confirmation, login and recovery with a synthetic address.
- Press Enter from every final field; verify password manager/autofill, field-specific errors, busy protection and preserved input.
- Keyboard Tab must follow visual order and focus must remain visible.

## Navigation and roles

- Sign in as OWNER, ADMIN, BOOKKEEPER, ACCOUNTANT and MEMBER synthetic users.
- Confirm each sees useful destinations and unavailable changes are clearly read-only/hidden.
- Verify deep links preserve business/account scope and mobile contains every critical permitted task.

## Dashboard and balances

- Confirm every value states period, account scope, calculation source and as-of time.
- Compare “Ledger balance” and bank freshness as distinct concepts.
- Warning signs: Connected with no last sync; one unlabeled balance used for bank and ledger concepts.

## Plaid and reconciliation

- Use sandbox/synthetic Items only.
- Verify healthy, syncing, pending, update-required, error and disconnected states.
- Open every reconcile dialog using keyboard; Tab must not leave it, Escape must follow safety rules, and closing must return to the trigger.
- Confirm source-removed matched history remains visibly preserved.

## Ledger, issues, vendors and close

- At 390px and 1440px, create/edit/review reversible synthetic data under explicit authorization.
- Confirm actions show immediate busy feedback, prevent double submit, preserve input after error and announce success.
- Verify destructive/closed-period consequences are specific.

## Accessibility

- Test 200% and 400% zoom, keyboard only, NVDA/VoiceOver, reduced motion and high contrast.
- Measure touch targets; use axe as a supplement, not proof of conformance.

## Audit conclusion

Public/auth layouts are visually credible and responsive. Do not sign off release until findings 001–003 are corrected and a fresh synthetic authenticated regression pass verifies the five roles and financial overlays.
