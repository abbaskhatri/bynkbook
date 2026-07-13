# Plaid Dashboard configuration for BynkBook

This is the production configuration baseline for BynkBook's `default` Link customization.

## App profile

- Application name: `BynkBook`
- Website: `https://bynkbook.com/`
- Support/compliance email: `bynkbook@gmail.com`
- Brand color: `#047857`
- Icon: `bynkbook-web/public/brand/bynkbook-plaid-logo-1024.png`
- Reason for data access:
  `BynkBook uses Plaid to securely retrieve selected account balances and transaction data for bookkeeping, categorization, reconciliation, and tax preparation.`

## Link customization: default

- Account Select: **Enabled for multiple accounts**
- Data Transparency use case: **Do business accounting and tax preparation**
- Remove identity/fraud messaging unless BynkBook begins requesting an Identity product in Link.
- Connected title: `Bank connected`
- Connected message: `Your selected bank accounts are securely connected to BynkBook. We’ll begin importing available transactions.`
- Connected button: `Return to BynkBook`
- Re-connected title: `Bank reconnected`
- Re-connected message: `Your selected bank accounts were reauthorized. BynkBook will refresh each recognized ledger separately.`
- Re-connected button: `Return to BynkBook`
- Institution Search / no results: `No supported bank was found. Try another search or return to BynkBook to upload a CSV.`
- Institution Search exit button: `Return to BynkBook`

Do not enable the Document Upload screens for the default Transactions flow. BynkBook does not currently request Plaid Income document uploads.

## Products

BynkBook currently uses:

- Transactions
- Balance (`/accounts/balance/get`) for balance/opening review

The application does not currently call Plaid Identity or Identity Match endpoints. Product access should be kept separate from the products requested in Link, and unused identity consent should not appear in the default Link flow.

Transactions Refresh is an optional paid add-on. Request access only after pricing approval; the application already falls back to Plaid's scheduled transaction data when Refresh is unavailable.

## Multi-account behavior

Plaid owns the Account Select consent screen. In update mode, BynkBook receives all selected accounts in Link's `onSuccess` metadata and:

1. preserves every previously selected account;
2. reconnects every uniquely recognized BynkBook ledger on the shared Plaid Item;
3. maps the current ledger by its existing Plaid identity or unique mask;
4. asks for a local mapping only when multiple returned accounts cannot be identified safely.

Official references:

- https://plaid.com/docs/link/update-mode/
- https://plaid.com/docs/link/customization/
- https://plaid.com/docs/transactions/transactions-data/

