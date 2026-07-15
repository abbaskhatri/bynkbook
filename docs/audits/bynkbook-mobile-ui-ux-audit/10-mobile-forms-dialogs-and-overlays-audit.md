# Mobile forms, dialogs, and overlays audit

## Inventory conclusion

The application has strong reusable Radix semantics, but one `AppDialog` pattern serves more than 52 instances from short confirmations to multi-table allocation and Plaid workflows. On mobile it becomes a bottom-attached sheet with a scroll body. This is appropriate only for a subset of uses.

## Pattern assignment

| Complexity | Use | Examples |
|---|---|---|
| Simple contextual choice | Bottom sheet | Sort, safe overflow actions, choose source |
| Serious single decision | Confirmation dialog | Reopen period, disconnect, void, delete, discard changes |
| Short edit (≤4 simple fields) | Full-height sheet only if keyboard-safe | Rename vendor, small preference |
| Complex edit/review | Dedicated full-screen route | Account create/edit, bill, payment allocation, upload review |
| Multi-record accounting operation | Guided full-screen flow | Manual/partial match, migration, Plaid mapping |

Nested sheets/dialogs are prohibited. A picker inside a full-screen flow is an inline page state or one simple sheet, not a second complex modal.

## Form specification

- Visible label remains above every control; placeholder is never the label.
- Email uses email keyboard; currency uses decimal keyboard and locale-safe parsing; dates use an accessible date control; account/vendor/category selectors are searchable when long.
- Required and optional state is explicit before validation.
- Errors appear beside the field and in a focusable summary; submission errors are announced.
- The first invalid field scrolls above the keyboard and sticky action bar.
- Submit has pending state, blocks duplicates, and preserves typed data on recoverable failure.
- Back/dismiss with unsaved data asks `Keep editing` or `Discard changes`.
- Successful save names the result and returns to the logical record/list anchor.

## Overlay accessibility

- Radix focus trap/title/description behavior is preserved.
- Close and all actions are at least 44px.
- Escape/browser back behavior is consistent and tested.
- Destructive buttons state the object and effect (`Disconnect institution`, not `Disconnect`).
- Loading retains the dialog/flow title and announces progress; errors do not silently close the overlay.
- Reduced motion replaces slide/zoom with a minimal fade.

## Keyboard matrix

Test 320x568 and 390x844 with the keyboard open on first, middle, and final fields; error after submit; selector open; date picker open; multiline note; rotation; screen reader; and browser back. The connected audit browser did not expose real mobile keyboard geometry, so this remains mandatory implementation validation.
