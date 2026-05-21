# Bynkbook Category Suggestion Rules

## Suggestion Output Format

Each suggestion should use this shape:

```json
{
  "suggestedCategory": "Category name",
  "confidence": "high | medium | low",
  "reason": "Brief reason based on available evidence",
  "requiresUserConfirmation": true,
  "suggestedMemo": "Only when safe and supported by the transaction text",
  "warning": "Only when uncertain or high-risk"
}
```

## General Behavior

- Do not auto-apply uncertain suggestions.
- Do not treat possible transfers as expenses unless evidence clearly supports an expense.
- Credit card payments and bank transfers need careful handling because they may not be business expenses.
- Use prior accepted user behavior only if the app has safe historical data available.
- Never learn from soft-deleted entries.
- Never use raw bank data if sync status is stale without warning.
- Always expose uncertainty.
- Do not invent missing vendor, memo, customer, tax, or category details.

## Category Guidance

| Signal | Suggested behavior |
| --- | --- |
| IRS, Internal Revenue Service, EFTPS | Suggest Taxes / Federal Tax Payment or Payroll Taxes when supported. Require confirmation and warn that CPA review may be needed. |
| Payroll, ADP, Gusto | Suggest Payroll Expense when the amount is an outflow and description clearly indicates payroll. |
| Rent, landlord, lease | Suggest Rent or Lease Expense when payee/history supports it. |
| Insurance | Suggest Insurance Expense; require confirmation if vendor could be benefits, auto, liability, or personal. |
| Gas station, fuel | Suggest Fuel / Auto Expense when business use is likely; require confirmation if mixed-use is possible. |
| Amazon | Use low or medium confidence. Could be Office Supplies, Inventory, Equipment, Software, or personal. Require confirmation unless history is strong. |
| Costco, Sam's, wholesale purchases | Use medium confidence only with memo/history. Could be Supplies, Inventory, Meals, or personal. |
| Office supply vendors | Suggest Office Supplies when vendor is clearly office-related. |
| Stripe, Square, merchant processors | For deposits, suggest Sales Income or Merchant Processor Deposits. For fees, suggest Merchant Fees when separated. |
| Bank fees | Suggest Bank Fees for service charges, overdraft fees, wire fees, returned item fees, and account fees. |
| Interest income | Suggest Interest Income for positive bank interest. |
| Loan payments | Usually split principal/interest in accounting, but Bynkbook should not invent splits. Suggest review and confirmation. |
| Credit card payments | Treat as potential transfer/payment, not automatically an expense. Warn about duplicating underlying card expenses. |
| Zelle received | Suggest Sales Income or Owner Contribution depending on known sender/history. Require confirmation. |
| Zelle sent | Could be contractor, vendor, owner draw, or transfer. Require confirmation. |
| ACH debit | Generic signal only. Use low confidence unless payee/history is clear. |
| ACH credit | Generic signal only. Could be sales, owner contribution, refund, loan proceeds, or transfer. Require confirmation. |
| Wire sent | Could be vendor payment, transfer, loan payment, payroll, or owner draw. Require confirmation. |
| Wire received | Could be sales income, owner contribution, loan proceeds, refund, or transfer. Require confirmation. |
| Checks | Use payee, memo, check number, and history. Do not infer category from "check" alone. |
| ATM withdrawal | Suggest Cash Withdrawal or Owner Draw only with caution. Require confirmation. |
| Owner draw | Suggest Owner Draw only when clearly indicated by payee/memo/history. |
| Owner contribution | Suggest Owner Contribution for clear owner deposits, capital contributions, or known owner Zelle deposits. Require confirmation. |
| Refunds | Category should usually follow the original expense or income category. Require confirmation unless linked history is clear. |
| Chargebacks | Suggest Chargebacks / Refunds / Sales Returns depending on available category set. Require confirmation. |

## Confidence Rules

- High confidence requires a clear vendor/payee signal and category alignment with transaction direction.
- Medium confidence means the category is plausible but could reasonably be something else.
- Low confidence means the AI should explain uncertainty and ask the user to review.
- Prior accepted history can raise confidence only when the source history is active, non-deleted, and scoped to the same business.
- Sensitive tax, payroll tax, loan, transfer, refund, and owner equity patterns should require confirmation even when confidence is high.
