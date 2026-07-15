# Mobile end-to-end flow matrix

| Flow ID | Flow / role | Start and steps | Current mobile status | Visibility/friction | Navigation/error/accessibility | Figma |
|---|---|---|---|---|---|---|
| BYNK-MOBILE-FLOW-001 | Sign in / public | Login → credentials/OAuth → workspace | Usable | Strong labels/targets | Error/keyboard still manual test | Reference |
| BYNK-MOBILE-FLOW-002 | Create business / authenticated no-workspace | Setup → fields → save → dashboard | Unverified runtime | Full form; keyboard risk | Back/unsaved/error require test | Yes |
| BYNK-MOBILE-FLOW-003 | Review entry / bookkeeper | Ledger → scan → detail → action → return | Poor | Table fragment; no canonical detail | Scroll/filter preservation not shared | Yes |
| BYNK-MOBILE-FLOW-004 | Reconcile suggestion / bookkeeper | Queue → tx → suggestion → linked record → confirm → next | Poor/blocking | Two tables + dialogs | Success destination and next-item flow weak | Yes |
| BYNK-MOBILE-FLOW-005 | Partial match / bookkeeper | Tx → allocate → review remaining → confirm | Poor/blocking | Critical amounts spread across modal/table | Keyboard/double-submit/back require test | Yes |
| BYNK-MOBILE-FLOW-006 | Manual match / bookkeeper | Tx → find candidate → inspect → confirm | Poor | Candidate 520px table in dialog | Nested complexity risk | Yes |
| BYNK-MOBILE-FLOW-007 | Filter transactions / bookkeeper | List → filter → chips → detail → back | Friction | Controls consume viewport | Persistence contract absent | Yes |
| BYNK-MOBILE-FLOW-008 | Connect bank / owner-admin | Accounts → Plaid → select → map → sync → success | Functional logic; poor mobile model | Similar account actions/dialogs | Cancellation/error/multi-account need synthetic test | Yes |
| BYNK-MOBILE-FLOW-009 | Reconnect / owner-admin | Action required → explain → update mode → sync → restored | Functional logic; poor presentation | Scope not unified | Must preserve last-known data | Yes |
| BYNK-MOBILE-FLOW-010 | Disconnect/archive / owner-admin | Account → review scope/effect → confirm | High-risk | Action at table edge/dialog | Explicit consequences exist; preserve | Yes |
| BYNK-MOBILE-FLOW-011 | Category review / bookkeeper | List → select → suggestions → apply | Poor | 780px table and dense rationale | Selection-mode accessibility missing | Yes |
| BYNK-MOBILE-FLOW-012 | Add/edit ledger entry / editor | Ledger → create/edit → validate → save | Poor | Inline spreadsheet inputs | Keyboard/scroll-to-error/back risk | Yes |
| BYNK-MOBILE-FLOW-013 | Upload receipt / editor | Create → file → parse → review → save | Dedicated mobile route | Better shell but competing IA | Failure/duplicate/keyboard need test | Yes |
| BYNK-MOBILE-FLOW-014 | Upload invoice/bill / AP user | Vendor/create → upload → parse → draft review | Poor | 1260px review table/dialog | Clear safety copy; flow too complex | Yes |
| BYNK-MOBILE-FLOW-015 | Apply vendor payment / AP user | Vendor → payment → bills → allocation → confirm | Poor/blocking | 560px allocation tables in dialogs | Remaining/ledger effect need sticky review | Yes |
| BYNK-MOBILE-FLOW-016 | Close/reopen period / owner | Closed periods → item → consequence → confirm | Moderate | Smaller surface | Permission/consequence copy strong | Yes |
| BYNK-MOBILE-FLOW-017 | Review report / authorized | Reports → range/account → chart/statement → detail | Moderate-poor | 640px rows and chart density | Text alternative required | Yes |
| BYNK-MOBILE-FLOW-018 | Manage team / owner-admin | Settings → team → role/invite/remove | Poor | Overflow tabs/tables/dialogs | Role restrictions need synthetic users | Yes |
| BYNK-MOBILE-FLOW-019 | Resolve issue / bookkeeper | Issues → filter → item → safe fix → success | Moderate | Dense filter/action layout | Auto-fix review uses dialog | Yes |
| BYNK-MOBILE-FLOW-020 | Search / authenticated | More → search → result → detail → back | Moderate | Search hidden in drawer | Return context requires test | Yes |

Status meanings: `Usable` = runtime evidence supports completion; `Moderate` = completion likely with friction; `Poor` = desktop pattern materially degrades mobile; `block­ing` = HIGH finding prevents safe/efficient use even when a workaround exists.
