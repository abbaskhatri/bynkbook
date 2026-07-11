# Dialog, Form, and Interaction Audit

## Overlay inventory

There are 51 reachable `AppDialog`/`AppSidePanel` instances: Reconcile 12, Settings 11, Ledger 7, Vendor detail 7, Plaid 4, and 10 across other domain components/pages.

## Shared primitive defect

`AppDialog` and `AppSidePanel` set `role="dialog"` and `aria-modal="true"`, focus the container on open, and support Escape. They do **not**:

- cycle Tab/Shift+Tab within the overlay;
- remember and restore the trigger;
- mark the background inert or `aria-hidden`;
- lock body/background scrolling;
- choose meaningful initial focus;
- consistently expose a labelled title/description (`AppSidePanel` has no `aria-labelledby`);
- prevent Escape when overlay dismissal is disabled for unsaved/destructive work.

This is one shared correction with broad reach, not 51 unrelated defects.

## Dialog density

Reconcile, Settings, Ledger and Vendor detail use 37 overlays combined. Many are justified by consequential financial actions, but the concentration increases context switching and confirmation fatigue. Use inline expansion for reversible inspection, side panels for sustained editing/context, and dialogs only for focused commits or consequences.

## Forms

Only three literal semantic `<form>` elements exist despite 163 input-control invocations. Login and business creation are semantic; signup, confirmation, forgot/reset password and most app/dialog editors use click handlers. Confirmed browser evidence on signup:

- password field is not contained in a form;
- email/password have empty `name` values;
- inputs have useful labels and autocomplete, but Enter/password-manager behavior is weaker.

Recommended Field/Form contract: every data-entry surface should use a form; submit through `onSubmit`; assign stable names; connect errors with `aria-describedby`; set `aria-invalid`; preserve values after server errors; disable and label busy submission; move initial focus to the first invalid field.

## Interaction feedback

Strengths include BusyButton, disabled-action explanations in reconciliation, optimistic hiding with later refresh, and explicit confirmation phrases. Gaps include only one `aria-live`/status occurrence, one `aria-busy`, and 16 blank Suspense fallbacks. Visual feedback often exists but is not consistently announced.

## Destructive action standard

- Title names the object/action.
- Body states financial/history consequences.
- Cancel is first, destructive action is explicit and danger-styled.
- Confirmation text only for irreversible or high-blast-radius actions.
- Overlay cannot dismiss while busy.
- Focus returns to trigger; success is announced and visible in the originating context.
