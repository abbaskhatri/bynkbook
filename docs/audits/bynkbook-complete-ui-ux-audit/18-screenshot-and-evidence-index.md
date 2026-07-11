# Screenshot and Evidence Index

All screenshots contain only public/static content or explicitly fictional sample data.

| Evidence | Route / viewport / state | Related findings |
|---|---|---|
| `output/playwright/ui-audit/landing-desktop-1440x1000.png` | `/`, 1440×1000, public | 001,007,011 |
| `output/playwright/ui-audit/landing-mobile-390x844.png` | `/`, 390×844, public | 001,008,011 |
| `output/playwright/ui-audit/login-mobile-390x844.png` | `/login`, 390×844, signed out | 007 |
| `output/playwright/ui-audit/signup-mobile-390x844.png` | `/signup`, 390×844, signed out | 006 |
| `output/playwright/ui-audit/privacy-placeholder-mobile-390x844.png` | `/privacy`, 390×844, placeholder paragraph | 001 |

## Command evidence

- Next build: 33 routes, exit 0.
- ESLint: exit 0.
- Vitest: 7 tests, exit 0.
- Browser production mode: no public/auth console errors.
- Viewports: 320×568, 390×844, 768×1024, 1440×900/1000; no landing horizontal overflow.
- Keyboard: first landing Tab is Product (no skip link); login first tabs are Google then Email.
- Signup DOM: inputs labelled/autocomplete but no form/name; Chromium warning recorded.
- Authenticated QA refresh: HTTP 400; no customer data or mutations performed.
- Static inventories: 31 pages, 52 component files, 51 reachable overlays, 397 buttons, 163 controls, 471 micro-type occurrences.

The ephemeral `.playwright-cli` session files are not audit deliverables and are excluded from the commit.
