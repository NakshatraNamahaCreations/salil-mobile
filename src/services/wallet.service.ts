import api from './api';
import { CoinTransaction } from '../types';

export const walletService = {
  // userId param kept for backward compatibility — backend uses JWT auth token
  async getBalance(_userId: string) {
    const response = await api.get('/reader/wallet');
    const wallet = response.data as any;
    return { coin_balance: wallet?.availableCoins ?? 0 };
  },

  // Credit coins after an Apple In-App Purchase of a coin pack. The backend
  // verifies the signed transaction with Apple before crediting.
  async verifyAppleCoinPurchase(packId: string, productId: string, jws: string) {
    const response = await api.post('/reader/wallet/verify-apple-coin-purchase', {
      packId,
      productId,
      jws,
    });
    return response.data as any;
  },

  // Unlock a whole book (ebook/audiobook) by spending coins.
  async unlockBook(bookId: string, purchaseType: 'ebook' | 'audiobook' = 'ebook') {
    const response = await api.post('/reader/wallet/unlock-book', { bookId, purchaseType });
    return response.data as any;
  },

  async getTransactions(_userId: string, page = 1, limit = 20) {
    const response = await api.get('/reader/wallet/transactions', { params: { page, limit } });
    const result = response.data as any;
    const transactions = Array.isArray(result?.transactions) ? result.transactions : [];
    const pagination = result?.pagination || null;
    return { transactions, pagination };
  },

  async getCoinPacks() {
    const response = await api.get('/reader/wallet/packs');
    return (response.data as any) || [];
  },

  async unlockContent(contentType: string, contentId: string, coinCost: number) {
    const response = await api.post('/reader/wallet/unlock', {
      contentType,
      contentId,
      coinCost,
    });
    return response.data;
  },
};
