# Accessibility Audit

This is not a WCAG conformance claim. Automated browser evidence covered public/auth pages; authenticated accessibility remained partially untestable.

## Confirmed findings

| Area | Evidence | Impact |
|---|---|---|
| Dialog focus | Shared primitives focus container but have no trap, restoration or inert background | Keyboard/screen-reader users can leave modal context |
| Dialog labelling | Side panel lacks `aria-labelledby`; descriptions are inconsistent | Overlay purpose may be unclear |
| Forms | Only 3 semantic forms; browser reports signup password outside form | Enter, password manager and error semantics weaken |
| Contrast | Light primary foreground is 3.77:1 on primary for 14px button text | Fails normal-text 4.5:1 target |
| Touch | Landing Sign in measured 76×32; source includes many 28/32px controls | Motor/touch difficulty |
| Typography | 471 10/11px utility occurrences | Readability/zoom burden |
| Skip navigation | First landing Tab lands on Product; no skip link found | Repetitive navigation cost |
| Async announcements | One live/status occurrence, one `aria-busy`, four alerts across a large async app | Updates may not be announced |

## Positive evidence

- Login labels and username/current-password autocomplete are present.
- Signup labels and username/new-password autocomplete are present despite missing form semantics.
- Protected redirect preserves a safe `next` path.
- Tooltips open on focus as well as pointer.
- Many icon controls have aria-labels and focus-ring classes.
- Semantic status colors include text and border, not color alone.

## Required validation after correction

- Keyboard-only modal cycles and focus return.
- NVDA/VoiceOver checks for dialogs, tables, errors and async success.
- Automated axe scan of every authenticated role/state.
- 200% and 400% zoom/reflow.
- Contrast audit across light/dark semantic tokens and charts.
- Touch-target measurement at 320/390 widths.
