# Backend requirements for App Store approval (api.saliljaveri.com)

The iOS app was rejected by Apple review (July 15, 2026) for five guideline
violations. The app-side fixes are already implemented in this repo, but they
depend on the following backend changes. Android/web behaviour is unchanged.

## 1. Account deletion endpoint — REQUIRED (guideline 5.1.1(v))

The app now has Profile → Delete Account, which calls:

```
DELETE /api/v1/reader/account
Authorization: Bearer <jwt>
```

Behaviour:
- Permanently delete (or irreversibly anonymize) the user document and all
  personal data: profile, phone, email, library, wishlist, progress, wallet,
  transactions, referral links.
- Deactivating/disabling is NOT sufficient — Apple explicitly rejects that.
- Return `{ success: true }` on completion; the app then clears the session.
- Idempotent: a second call with a dead token can return 401 — fine.

## 2. Optional phone at registration — REQUIRED (guideline 5.1.1(v))

`POST /api/v1/auth/register` must accept requests **without** a `phone` field.
The app no longer sends `phone` when the user leaves it blank. Email + name +
password remain required. Nothing else changes.

## 3. Apple In-App Purchase verification — REQUIRED (guideline 3.1.1)

On iOS, book/audiobook purchases now go through Apple IAP (StoreKit) instead
of Razorpay. After Apple confirms the payment, the app sends the signed
transaction to:

```
POST /api/v1/reader/books/:contentId/verify-apple-purchase
Authorization: Bearer <jwt>
Body: {
  "purchaseType": "ebook" | "audiobook",
  "productId": "book_<contentId>" | "audiobook_<contentId>",
  "transactionId": "<Apple transaction id>",
  "jws": "<signed JWS transaction from StoreKit 2>"
}
```

Behaviour:
1. Verify the JWS signature and transaction with Apple. Options:
   - Decode + verify the JWS locally against Apple's root certificates
     (libraries: `app-store-server-api` on npm, or Apple's
     `app-store-server-library-node`), and/or
   - Call Apple's App Store Server API `GET /inApps/v1/transactions/{transactionId}`
     using an App Store Connect API key (recommended).
2. Check `bundleId == com.saliljaveri` and the productId matches the content.
3. Reject replays: store the Apple `transactionId` uniquely; the same
   transaction may be re-sent by Restore Purchases — in that case just ensure
   the purchase exists for THIS user and return success.
4. Grant the purchase exactly like a verified Razorpay payment does today
   (so `/reader/books/:id/purchase-status` and `/reader/purchases` reflect it).
5. Return `{ success: true }`.

Product ID convention: `book_<contentId>` for ebooks, `audiobook_<contentId>`
for audiobooks — matching what the app requests from Apple. Optionally add an
`apple_product_id` field to content documents (returned by
`/reader/content/:id`) to override this convention per title.

## 4. App Store Connect setup (client/account owner, not backend)

- Sign the **Paid Applications agreement** (App Store Connect → Business).
- For every paid book/audiobook, create a **non-consumable IAP product** with
  the Product ID from the convention above and a price tier ≈ the INR price.
  (Currently: 1 book × ₹299 → e.g. price tier ₹299.)
- Create an **App Store Connect API key** (Users and Access → Integrations)
  for the backend verification in section 3.

## Also fixed app-side (no backend change needed)

- Guests can browse Home/Explore without an account (browse endpoints are
  already public — verified).
- Coupon codes, wallet/coins, referral rewards and the subscription screen are
  hidden on iOS (they bypass Apple IAP). All remain live on Android/web.
- "Restore Purchases" button added (Apple requirement) — re-sends owned
  transactions to the endpoint in section 3.
