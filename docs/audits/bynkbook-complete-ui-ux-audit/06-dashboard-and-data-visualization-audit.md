# Dashboard and Data-Visualization Audit

## What works

- The dashboard states period and scope.
- KPI hierarchy covers Cash Balance, Cash Runway, Revenue, Expenses and Net.
- Cash-basis language is present for revenue/expenses.
- Charts are dynamically loaded and separated into dedicated panels.
- Attention and account balance sections are actionable domains rather than decoration.
- AI is labelled “Suggestion-only.”

## Risks

- Eight query surfaces contribute to a dense initial orchestration; actual authenticated timing could not be measured.
- “Cash Balance” and “Account Balances” show an as-of date but not that values are ledger/report-derived rather than Plaid current/available balances.
- A separate reports note says opening-balance-driven account balances are excluded, but that calculation boundary is not visible on dashboard cards.
- Heavy use of 10/11px metadata reduces readability.
- Account, chart and AI cards compete at equal visual weight; immediate attention should precede analysis.

## Recommended hierarchy

1. Needs attention / connection health.
2. Cash position with source and as-of label.
3. Revenue, expenses and net for selected period.
4. Recent business activity.
5. Charts and category breakdown.
6. AI narrative/anomalies behind progressive disclosure.

## Visualization rules

- Every chart states date range, account scope, unit, zero/no-data state and calculation source.
- Never imply bank freshness from ledger-derived data.
- Preserve accessible data summaries and do not rely on red/green alone.
- Limit dashboard card count; move deep category/account tables to Reports.
