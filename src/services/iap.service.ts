import { Platform } from 'react-native';
import api from './api';

// Apple In-App Purchase flow (App Store guideline 3.1.1).
//
// Digital content on iOS must be bought through Apple IAP — never Razorpay,
// coupons or wallet coins. Each purchasable book/audiobook needs a matching
// non-consumable product created in App Store Connect whose Product ID is
// stored on the content record in the backend (`apple_product_id`). When the
// backend hasn't assigned one yet we fall back to a deterministic ID derived
// from the content ID, so products can be pre-registered in ASC without a
// backend change: book_<contentId> / audiobook_<contentId>.
//
// After StoreKit reports the purchase, the signed transaction (JWS) is sent to
// the backend, which verifies it with Apple's App Store Server API and grants
// the purchase to the signed-in account (same effect as a verified Razorpay
// payment on Android).

// expo-iap is a native module — absent on web and in builds that predate it.
const ExpoIap: any = (() => {
  if (Platform.OS === 'web') return null;
  try {
    return require('expo-iap');
  } catch {
    return null;
  }
})();

export type IapPurchaseType = 'ebook' | 'audiobook';

export function appleProductIdFor(contentId: string, purchaseType: IapPurchaseType, explicitId?: string | null) {
  if (explicitId) return explicitId;
  return `${purchaseType === 'audiobook' ? 'audiobook' : 'book'}_${contentId}`;
}

export const iapService = {
  isAvailable(): boolean {
    return Platform.OS === 'ios' && !!ExpoIap;
  },

  async init(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try {
      await ExpoIap.initConnection();
      return true;
    } catch (e) {
      console.error('IAP initConnection failed', e);
      return false;
    }
  },

  async end(): Promise<void> {
    if (!this.isAvailable()) return;
    try {
      await ExpoIap.endConnection();
    } catch {
      // already closed — ignore
    }
  },

  // Look up the App Store product so the button can show Apple's localized price.
  async getProduct(productId: string): Promise<{ id: string; displayPrice: string } | null> {
    if (!this.isAvailable()) return null;
    try {
      const products = await ExpoIap.fetchProducts({ skus: [productId], type: 'in-app' });
      const p = Array.isArray(products) ? products[0] : null;
      if (!p) return null;
      return { id: p.id ?? productId, displayPrice: p.displayPrice ?? '' };
    } catch (e) {
      console.error('IAP fetchProducts failed', e);
      return null;
    }
  },

  // Runs the full purchase: StoreKit payment sheet → backend receipt
  // verification → finish transaction. Resolves true when the backend has
  // granted the content to the user's account.
  async purchase(contentId: string, purchaseType: IapPurchaseType, productId: string): Promise<boolean> {
    if (!this.isAvailable()) throw new Error('In-app purchases are not available in this build.');

    const purchase = await ExpoIap.requestPurchase({
      request: { apple: { sku: productId } },
      type: 'in-app',
    });
    const tx = Array.isArray(purchase) ? purchase[0] : purchase;
    if (!tx) throw new Error('Purchase was not completed.');

    const jws = tx.purchaseToken ?? tx.transactionReceipt ?? null;
    if (!jws) throw new Error('Missing purchase receipt.');

    // Backend verifies the JWS with Apple and records the purchase.
    await api.post(`/reader/books/${contentId}/verify-apple-purchase`, {
      purchaseType,
      productId,
      transactionId: tx.transactionId ?? tx.id ?? null,
      jws,
    });

    // Only acknowledge to Apple after our backend accepted the purchase, so a
    // crash in between re-delivers the transaction instead of losing it.
    try {
      await ExpoIap.finishTransaction({ purchase: tx, isConsumable: false });
    } catch (e) {
      console.error('IAP finishTransaction failed', e);
    }
    return true;
  },

  // "Restore Purchases" — required by Apple for non-consumables. Re-syncs
  // every owned transaction with the backend so the account regains access.
  async restore(): Promise<number> {
    if (!this.isAvailable()) return 0;
    const purchases = await ExpoIap.getAvailablePurchases();
    let restored = 0;
    for (const tx of purchases ?? []) {
      const jws = tx.purchaseToken ?? tx.transactionReceipt ?? null;
      const productId: string = tx.productId ?? tx.id ?? '';
      if (!jws || !productId) continue;
      const purchaseType: IapPurchaseType = productId.startsWith('audiobook_') ? 'audiobook' : 'ebook';
      const contentId = productId.replace(/^(audiobook|book)_/, '');
      try {
        await api.post(`/reader/books/${contentId}/verify-apple-purchase`, {
          purchaseType,
          productId,
          transactionId: tx.transactionId ?? tx.id ?? null,
          jws,
        });
        restored += 1;
      } catch (e) {
        console.error('IAP restore verify failed for', productId, e);
      }
    }
    return restored;
  },
};
