# Bynkbook AI Examples

## A. IRS Payment

Input:

- Payee: IRS TREAS 310
- Amount: -1500

Expected output:

- Category: Taxes / Federal Tax Payment
- Confidence: High
- Reason: Payee indicates IRS or federal tax payment.
- Requires confirmation: true
- Warning: Confirm with CPA whether this should be categorized as business tax, payroll tax, estimated tax, or owner-related tax.

## B. Zelle Received

Input:

- Description: Zelle from John Smith
- Amount: +750

Expected output:

- Category: Sales Income or Owner Contribution depending on known sender/history
- Confidence: Medium
- Requires confirmation: true
- Warning: Sender identity alone is not enough to prove income type.

## C. Amazon Purchase

Input:

- Description: Amazon Marketplace
- Amount: -186.42

Expected output:

- Category: Office Supplies / Inventory / Equipment depending on memo/history
- Confidence: Low/Medium
- Requires confirmation: true
- Warning: Amazon purchases are ambiguous without memo, receipt, or accepted history.

## D. Payroll

Input:

- Description: Gusto Payroll
- Amount: -2400

Expected output:

- Category: Payroll Expense
- Confidence: High
- Requires confirmation: false or true depending on app policy
- Reason: Payee clearly indicates a payroll provider and the amount is an outflow.

## E. Credit Card Payment

Input:

- Description: Chase Card Payment
- Amount: -900

Expected output:

- Category: Potential transfer/payment, not automatically an expense
- Confidence: Medium
- Requires confirmation: true
- Warning: Do not duplicate underlying credit card expenses.

## F. Bank Fee

Input:

- Description: Monthly service fee
- Amount: -15

Expected output:

- Category: Bank Fees
- Confidence: High
- Requires confirmation: false or true depending on app policy
- Reason: Description indicates a bank account service fee.

## G. Refund

Input:

- Description: Refund from vendor
- Amount: +80

Expected output:

- Category: Depends on original expense/category
- Confidence: Medium
- Requires confirmation: true
- Warning: Match the refund to the original transaction when possible.

## H. Soft-Deleted Entry

Expected behavior:

- Exclude from totals.
- Exclude from reports.
- Exclude from summaries.
- Exclude from reconciliation.
- Exclude from category suggestions.
- Exclude from AI learning/history.
- Keep only as historical or audit context when explicitly requested.
