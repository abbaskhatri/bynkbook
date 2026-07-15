# Mobile responsive and device matrix

## Runtime evidence

Production public pages were tested in the connected browser on 2026-07-15. Protected screens redirected to login because no authenticated test session was available; protected viewport conclusions combine source inspection and tracked redacted evidence.

| Viewport | Orientation | Public landing | Login/form | Protected evidence | Result / findings |
|---:|---|---|---|---|---|
| 320x568 | Portrait | No horizontal overflow; 5,029px document | No overflow; visible labels; 16px inputs; 44px controls | Source shows 520–1260px tables | Public pass; protected major redesign (`001`–`020`) |
| 360x640 | Portrait | No horizontal overflow; 4,774px document | Source-equivalent auth layout | Same | Public pass; protected major redesign |
| 375x667 | Portrait | No horizontal overflow; 4,774px document | Source-equivalent auth layout | Same | Public pass; protected major redesign |
| 390x844 | Portrait | No horizontal overflow; 4,755px document | Source-equivalent auth layout | Redacted reconcile screenshot at phone width | Public pass; reconcile fails information hierarchy (`001`, `009`) |
| 393x852 | Portrait | No horizontal overflow; 4,723px document | Source-equivalent auth layout | Same source constraints | Public pass; protected major redesign |
| 412x915 | Portrait | No horizontal overflow; 4,691px document | Source-equivalent auth layout | Same source constraints | Public pass; protected major redesign |
| 430x932 | Portrait | No horizontal overflow; 4,589px document | Source-equivalent auth layout | 520px minimum still exceeds viewport | Public pass; protected major redesign |
| 844x390 | Landscape | Not captured in connected run | Source review only | Fixed bottom navigation and dense tables remain risks | Required before implementation signoff |
| 640x360 | Landscape | Not captured in connected run | Source review only | Very low vertical space + fixed nav/dialog header/footer | Required before implementation signoff |

## Edge-case coverage

| Condition | Audit status | Limitation / required validation |
|---|---|---|
| Long names/descriptions | Source confirmed widespread truncation/fixed widths | Synthetic runtime set required |
| Large/negative/zero amounts | Formatting paths exist | Visual row variants required |
| Multiple currencies | Not confirmed as supported | Founder/product decision; do not imply support |
| Empty/loading/error/success | Source states exist on major routes | Figma variants and runtime regression required |
| Large datasets | Reconcile virtualization confirmed | Ledger/vendor/settings synthetic performance required |
| Offline/failed requests | Error banners exist | Offline injection unavailable in connected browser |
| Restricted roles | Policy code exists | No OWNER/ADMIN/MEMBER synthetic sessions available |
| Browser zoom | Not controllable | Test 200%/400% reflow in implementation phase |
| OS text scaling | Not controllable | Test platform large accessibility sizes |
| Keyboard open | Virtual keyboard not exposed | Real-device testing mandatory |
| Safe areas | CSS `env(safe-area-inset-bottom)` used in nav | Test notches/home indicator in device lab |

## Evidence files

- `evidence/prod-login-320x568.png`
- `evidence/prod-landing-390x844.png`
- Existing tracked evidence: `output/playwright/re-audit-2026-07-11/reconcile-mobile.png`
