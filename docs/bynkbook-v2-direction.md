# Bynkbook V2 Direction

Figma file: https://www.figma.com/design/GPw4EW6K54RFmpVR3ysF2J

## Product Feel

Bynkbook V2 should feel faster, calmer, and more direct. The app should keep the dense accounting workflow that already works, while reducing duplicate panels and putting the next useful action closer to the top of each page.

## Current First Slice

- Keep the ledger new-entry table behavior unchanged.
- Add a dashboard command center for issues, uncategorized entries, and unmatched bank activity.
- Remove the duplicate dashboard right-rail next-actions card.
- Use the Figma token foundation as the design reference, with production CSS remaining the source of truth.

## Next V2 Candidates

- Vendor workspace: one compact action rail for unpaid bills, uploads, statements, and payment application.
- Upload review: faster optimistic file state, clearer parse/review/import statuses, and fewer full-page reload patterns.
- Reconcile workspace: more instant local completion states while background matching and invalidation finish.
- App shell: consistent page headers, denser filter bars, and fewer repeated card shells.
- Performance: preserve cached data during refetches, prefer optimistic UI for low-risk actions, and measure hot routes with repeatable smoke scripts.
