import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  Alert,
  Modal,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { Platform, Linking } from 'react-native';

// Native Razorpay SDK — only on Android/iOS, never available on web.
// Wrapped in a try so a metro-only debug session without the native module
// doesn't blow up the require chain.
const RazorpayCheckout: any = (() => {
  if (Platform.OS === 'web') return null;
  try {
    return require('react-native-razorpay').default;
  } catch {
    return null;
  }
})();
// WebView is only available on native — conditionally imported below
let WebView: any = null;
if (Platform.OS !== 'web') {
  WebView = require('react-native-webview').WebView;
}
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { typography } from '../../src/theme/typography';
import { spacing } from '../../src/theme/spacing';
import { contentService } from '../../src/services/content.service';
import { walletService } from '../../src/services/wallet.service';
import { paymentService } from '../../src/services/payment.service';
import { Content, AccessType, Chapter } from '../../src/types';
import { useAppSelector } from '../../src/hooks/useAppSelector';
import { useAppDispatch } from '../../src/hooks/useAppDispatch';
import { addToWishlist, removeFromWishlist } from '../../src/store/slices/contentSlice';
import { updateCoinBalance } from '../../src/store/slices/authSlice';
import { LoadingScreen } from '../../src/components/layout/LoadingScreen';
import { Button } from '../../src/components/buttons/Button';
import { useTheme } from '../../src/theme/ThemeContext';
import { ReviewSection } from '../../src/components/ReviewSection';
import { getContentSectionLabels } from '../../src/utils/contentLabels';
import { iapService, appleProductIdFor } from '../../src/services/iap.service';

// On iOS all digital-content purchases must go through Apple In-App Purchase
// (App Store guideline 3.1.1) — Razorpay, coupons and coin unlocks are
// Android/web only.
const IS_IOS = Platform.OS === 'ios';

interface RazorpayOrder {
  order_id: string;
  amount: number;
  currency: string;
  key_id: string;
  book_title: string;
  callback_url?: string;
}

export default function BookDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const dispatch = useAppDispatch();
  const { colors } = useTheme();
  const { user } = useAppSelector((state) => state.auth);
  const wishlist = useAppSelector((state) => state.content.wishlist);

  const [book, setBook] = useState<Content | null>(null);
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPurchased, setIsPurchased] = useState(false);
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [showRazorpay, setShowRazorpay] = useState(false);
  const [razorpayOrder, setRazorpayOrder] = useState<RazorpayOrder | null>(null);
  // Refs that survive WebView re-mounts so we never lose a successful payment
  // to a stray close tap.
  const verifyingRef = useRef(false);
  const pendingPaymentRef = useRef<{ razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string } | null>(null);

  // Coupon
  const [couponInput, setCouponInput] = useState('');
  const [couponLoading, setCouponLoading] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; discountAmount: number; finalAmount: number; description: string } | null>(null);

  // Apple IAP — localized App Store price shown on the Buy button (iOS only)
  const [iapPrice, setIapPrice] = useState<string | null>(null);
  const [restoreLoading, setRestoreLoading] = useState(false);

  const inWishlist = wishlist.some((item) => item.id === id);

  const iapPurchaseType = (b: Content | null) =>
    (b as any)?.book_content_type === 'audiobook' ? ('audiobook' as const) : ('ebook' as const);
  const iapProductId = (b: Content | null) =>
    appleProductIdFor(id, iapPurchaseType(b), (b as any)?.apple_product_id);

  // Fetch the App Store product price once the book loads (iOS, paid, not owned)
  useEffect(() => {
    if (!IS_IOS || !book || isPurchased || book.access_type !== AccessType.PAID) return;
    let cancelled = false;
    (async () => {
      const ok = await iapService.init();
      if (!ok || cancelled) return;
      const product = await iapService.getProduct(iapProductId(book));
      if (!cancelled && product?.displayPrice) setIapPrice(product.displayPrice);
    })();
    return () => { cancelled = true; };
  }, [book?.id, isPurchased]);

  // Re-run when `user` becomes available: on a cold start the first pass can run
  // before auth is hydrated from storage, which would skip the purchase / chapter
  // unlock checks and wrongly show "Buy" for an already-purchased book.
  useEffect(() => { loadBook(); }, [id, user?.id]);

  const loadBook = async () => {
    try {
      const data = await contentService.getContentById(id);

      // Fetch chapter unlock statuses if logged in
      if (user) {
        try {
          const statusRes = await contentService.getChapterStatus(id);
          if (statusRes && Array.isArray(statusRes.data)) {
            data.chapters = statusRes.data;
          }
        } catch (e) {
          console.error('Could not fetch chapter statuses', e);
        }

        // Fetch purchase status for paid books
        try {
          const status = await paymentService.getPurchaseStatus(id);
          setIsPurchased(status.purchased ?? false);
        } catch (e) {
          console.error('Could not fetch purchase status', e);
        }
      }

      setBook(data);
    } catch {
      Alert.alert('Error', 'Failed to load book details');
    } finally {
      setLoading(false);
    }
  };

  const handleRead = () => {
    if (!book) return;
    if (book.chapters && book.chapters.length > 0) {
      handleChapterPress(book.chapters[0], 0);
    } else {
      Alert.alert('Coming Soon', 'This book has no chapters yet.');
    }
  };

  // ── Web: load Razorpay checkout.js and open popup ─────────────
  const openRazorpayWeb = (order: RazorpayOrder) => {
    return new Promise<void>((resolve, reject) => {
      // Load script if not already loaded
      const existing = document.getElementById('razorpay-checkout-js');
      const doOpen = () => {
        const options: any = {
          key: order.key_id,
          amount: order.amount,
          currency: order.currency,
          name: 'Salil Javeri',
          description: order.book_title,
          order_id: order.order_id,
          handler: async (response: any) => {
            setPurchaseLoading(true);
            try {
              await paymentService.verifyPayment(id, {
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              });
              setIsPurchased(true);
              router.push({
                pathname: '/payment-success',
                params: {
                  bookTitle: order.book_title,
                  amount: String(Math.round(order.amount / 100)),
                  bookId: id,
                  paymentId: response.razorpay_payment_id,
                },
              });
            } catch (err: any) {
              router.push({
                pathname: '/payment-failure',
                params: {
                  bookTitle: order.book_title,
                  amount: String(Math.round(order.amount / 100)),
                  bookId: id,
                  errorMessage: 'We could not verify your payment. If the amount was debited, it will be refunded within 5–7 business days.',
                },
              });
            } finally {
              setPurchaseLoading(false);
            }
            resolve();
          },
          modal: { ondismiss: () => resolve() },
          prefill: { name: user?.name || '', contact: user?.mobile_number || '' },
          theme: { color: '#FF6B6B' },
        };
        const rzp = new (window as any).Razorpay(options);
        rzp.on('payment.failed', (r: any) => {
          router.push({
            pathname: '/payment-failure',
            params: {
              bookTitle: order.book_title,
              amount: String(Math.round(order.amount / 100)),
              bookId: id,
              errorMessage: r.error?.description || 'Payment failed.',
            },
          });
          resolve();
        });
        rzp.open();
      };

      if (existing) {
        doOpen();
      } else {
        const script = document.createElement('script');
        script.id = 'razorpay-checkout-js';
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.onload = doOpen;
        script.onerror = () => reject(new Error('Failed to load payment gateway'));
        document.body.appendChild(script);
      }
    });
  };

  const handleApplyCoupon = async () => {
    if (!book || !couponInput.trim()) return;
    const price = book.price_inr ?? 0;
    setCouponLoading(true);
    try {
      const pType = book.book_content_type === 'audiobook' ? 'audiobook' : 'ebook';
      const res = await paymentService.validateCoupon(couponInput.trim(), id, pType, price);
      const data = res.data || res;
      setAppliedCoupon({
        code: data.code,
        discountAmount: data.discountAmount,
        finalAmount: data.finalAmount,
        description: data.description || '',
      });
      setCouponInput('');
    } catch {
      Alert.alert('Invalid Coupon', 'This coupon code is invalid or has expired. Please check and try again.');
    } finally {
      setCouponLoading(false);
    }
  };

  const promptSignIn = () => {
    Alert.alert(
      'Sign In Required',
      'Purchases are linked to your account so you can access them on all your devices. Please sign in or create a free account first.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign In', onPress: () => router.push('/login') },
      ],
    );
  };

  // ── iOS: Apple In-App Purchase flow (guideline 3.1.1) ─────────
  const handleBuyIOS = async () => {
    if (!book) return;
    if (!user?.id) { promptSignIn(); return; }
    setPurchaseLoading(true);
    try {
      await iapService.purchase(id, iapPurchaseType(book), iapProductId(book));
      setIsPurchased(true);
      Alert.alert('Purchase Complete', `"${book.title}" has been added to your library. Enjoy!`);
    } catch (err: any) {
      const code = err?.code ?? '';
      const msg = String(err?.message ?? '');
      // User closed the Apple payment sheet — not an error.
      if (code === 'E_USER_CANCELLED' || /cancel/i.test(msg)) return;
      Alert.alert(
        'Purchase Failed',
        'Your purchase could not be completed. You have not been charged — please try again, or contact support if the problem continues.',
      );
    } finally {
      setPurchaseLoading(false);
    }
  };

  // Apple requires a Restore Purchases option for non-consumable IAP.
  const handleRestorePurchases = async () => {
    if (!user?.id) { promptSignIn(); return; }
    setRestoreLoading(true);
    try {
      await iapService.init();
      const count = await iapService.restore();
      if (count > 0) {
        const status = await paymentService.getPurchaseStatus(id);
        setIsPurchased(status.purchased ?? false);
        Alert.alert('Purchases Restored', 'Your previous purchases have been restored to this account.');
      } else {
        Alert.alert('Nothing to Restore', 'No previous purchases were found for this Apple ID.');
      }
    } catch {
      Alert.alert('Restore Failed', 'We could not restore purchases right now. Please try again later.');
    } finally {
      setRestoreLoading(false);
    }
  };

  const handleBuy = async () => {
    if (!book) return;
    if (IS_IOS) { await handleBuyIOS(); return; }
    if (!user?.id) { promptSignIn(); return; }
    setPurchaseLoading(true);
    try {
      const pType = book.book_content_type === 'audiobook' ? 'audiobook' : 'ebook';
      const order = await paymentService.createBookOrder(id, pType, appliedCoupon?.code);
      if (order.already_purchased) {
        setIsPurchased(true);
        return;
      }
      const rzpOrder: RazorpayOrder = {
        order_id: order.order_id,
        amount: order.amount,
        currency: order.currency,
        key_id: order.key_id,
        book_title: order.book_title,
        callback_url: order.callback_url,
      };

      if (Platform.OS === 'web') {
        setPurchaseLoading(false);
        await openRazorpayWeb(rzpOrder);
        return;
      }

      // Native flow: open Razorpay's native Checkout SDK. No WebView, no
      // modal lifecycle, no cleartext/deep-link issues. The Promise resolves
      // synchronously with the payment IDs we need to verify server-side.
      if (!RazorpayCheckout) {
        Alert.alert(
          'Payment Unavailable',
          'Native checkout is not bundled in this build. Please rebuild the app with `npx expo run:android` (or a fresh release APK).',
        );
        return;
      }

      setPurchaseLoading(false);
      try {
        const response = await RazorpayCheckout.open({
          key: rzpOrder.key_id,
          amount: rzpOrder.amount,
          currency: rzpOrder.currency,
          name: 'Salil Javeri',
          description: rzpOrder.book_title,
          order_id: rzpOrder.order_id,
          prefill: {
            name: user?.name || '',
            contact: user?.mobile_number || '',
            email: (user as any)?.email || '',
          },
          theme: { color: '#FF6B6B' },
        });

        // Verify with backend, then navigate.
        setPurchaseLoading(true);
        try {
          await paymentService.verifyPayment(id, {
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
          });
          setIsPurchased(true);
          router.push({
            pathname: '/payment-success',
            params: {
              bookTitle: rzpOrder.book_title,
              amount: String(Math.round(rzpOrder.amount / 100)),
              bookId: id,
              paymentId: response.razorpay_payment_id || '',
            },
          });
        } catch {
          router.push({
            pathname: '/payment-failure',
            params: {
              bookTitle: rzpOrder.book_title,
              amount: String(Math.round(rzpOrder.amount / 100)),
              bookId: id,
              errorMessage:
                'We could not verify your payment. If the amount was debited, it will be refunded within 5–7 business days. Please contact support if you need help.',
            },
          });
        } finally {
          setPurchaseLoading(false);
        }
      } catch (err: any) {
        // Razorpay SDK rejects with { code, description } on cancel / failure.
        // code 0 = user cancelled — show nothing.
        const code = err?.code;
        const description = err?.description || 'Payment was not completed.';
        if (code === 0 || /cancel/i.test(description)) return;
        router.push({
          pathname: '/payment-failure',
          params: {
            bookTitle: rzpOrder.book_title,
            amount: String(Math.round(rzpOrder.amount / 100)),
            bookId: id,
            errorMessage: description,
          },
        });
      }
    } catch {
      Alert.alert('Payment Error', 'We could not start the payment right now. Please check your internet connection and try again.');
    } finally {
      setPurchaseLoading(false);
    }
  };

  const verifyAndRoute = async (paymentData: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
    if (verifyingRef.current) return; // dedupe — already verifying
    verifyingRef.current = true;
    setPurchaseLoading(true);
    try {
      await paymentService.verifyPayment(id, paymentData);
      setIsPurchased(true);
      pendingPaymentRef.current = null;
      setShowRazorpay(false);
      // Wait for the Razorpay Modal to fully animate out before pushing a new
      // screen — on Android, navigating while a Modal is still dismissing can
      // crash the app (native view tree desync).
      setTimeout(() => {
        router.push({
          pathname: '/payment-success',
          params: {
            bookTitle: razorpayOrder?.book_title || '',
            amount: String(Math.round((razorpayOrder?.amount || 0) / 100)),
            bookId: id,
            paymentId: paymentData.razorpay_payment_id || '',
          },
        });
      }, 600);
    } catch (err: any) {
      // Keep pendingPaymentRef so the user can retry from the failure screen if needed.
      setShowRazorpay(false);
      setTimeout(() => {
        router.push({
          pathname: '/payment-failure',
          params: {
            bookTitle: razorpayOrder?.book_title || '',
            amount: String(Math.round((razorpayOrder?.amount || 0) / 100)),
            bookId: id,
            errorMessage: 'We could not verify your payment. If the amount was debited, it will be refunded within 5–7 business days. Please contact support if you need help.',
          },
        });
      }, 600);
    } finally {
      setPurchaseLoading(false);
      verifyingRef.current = false;
    }
  };

  const handleRazorpayMessage = async (event: any) => {
    try {
      const message = JSON.parse(event.nativeEvent.data);
      if (message.type === 'PAYMENT_SUCCESS') {
        pendingPaymentRef.current = message.data;
        await verifyAndRoute(message.data);
      } else if (message.type === 'PAYMENT_FAILED') {
        // If a successful payment was already captured, ignore the dismiss/cancel —
        // verification is already underway.
        if (verifyingRef.current || pendingPaymentRef.current) return;
        setShowRazorpay(false);
        if (message.error !== 'dismissed') {
          // Defer navigation so the Modal fully unmounts first (Android crash guard).
          setTimeout(() => {
            router.push({
              pathname: '/payment-failure',
              params: {
                bookTitle: razorpayOrder?.book_title || '',
                amount: String(Math.round((razorpayOrder?.amount || 0) / 100)),
                bookId: id,
                errorMessage: message.error || 'Payment was not completed.',
              },
            });
          }, 600);
        }
      }
    } catch (e) {
      // Non-JSON message from WebView — ignore
    }
  };

  const handleRazorpayModalClose = () => {
    if (verifyingRef.current) {
      Alert.alert('Confirming Purchase', 'Please wait — your purchase is being confirmed. Do not close this screen.');
      return;
    }
    if (pendingPaymentRef.current) {
      // Payment succeeded but verify never completed (race). Retry the verify now.
      verifyAndRoute(pendingPaymentRef.current);
      return;
    }
    setShowRazorpay(false);
  };

  const handleChapterPress = (chapter: Chapter, index: number = 0) => {
    if (!book) return;

    // Audiobook — tap chapter = play that track
    if (book.book_content_type === 'audiobook') {
      if (isPurchased || book.access_type === AccessType.FREE) {
        router.push(`/player/${book.id}?chapterIndex=${index}`);
      } else {
        {
          const priceLabel = (IS_IOS && iapPrice) ? iapPrice : `₹${book.price_inr ?? 0}`;
          Alert.alert(
            'Purchase Required',
            `Buy this audiobook for ${priceLabel} to listen.`,
            [{ text: 'Cancel', style: 'cancel' }, { text: `Buy ${priceLabel}`, onPress: handleBuy }]
          );
        }
      }
      return;
    }

    // Purchased book or free book — all chapters open directly
    if (isPurchased || book.access_type === AccessType.FREE) {
      router.push({ pathname: '/reader/[id]', params: { id: book.id, chapterId: chapter.id } });
      return;
    }

    // Paid book not yet purchased — prompt buy
    if (book.access_type === AccessType.PAID) {
      const priceLabel = (IS_IOS && iapPrice) ? iapPrice : `₹${book.price_inr ?? 0}`;
      Alert.alert(
        'Purchase Required',
        `Buy this book for ${priceLabel} to read all chapters.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: `Buy ${priceLabel}`, onPress: handleBuy },
        ]
      );
      return;
    }

    // Coin-based chapter unlock (for non-book content types)
    if (chapter.is_free || chapter.is_unlocked) {
      router.push({ pathname: '/reader/[id]', params: { id: book.id, chapterId: chapter.id } });
    } else {
      showUnlockPrompt(chapter);
    }
  };

  const showUnlockPrompt = (chapter: Chapter) => {
    // Coin unlocks bypass Apple IAP — not offered on iOS (guideline 3.1.1)
    if (IS_IOS) {
      Alert.alert('Chapter Locked', 'This chapter is not available yet.');
      return;
    }
    Alert.alert(
      'Chapter Locked',
      `This chapter costs ${chapter.coin_cost} coins to unlock. You have ${user?.coin_balance || 0} coins.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unlock with Coins', onPress: () => unlockChapter(chapter) },
      ]
    );
  };

  const unlockChapter = async (chapter: Chapter) => {
    if (!user || !book) return;
    if ((user.coin_balance || 0) < (chapter.coin_cost || 0)) {
      Alert.alert('Insufficient Coins', 'You do not have enough coins to unlock this chapter.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Buy Coins', onPress: () => router.push('/wallet') },
      ]);
      return;
    }

    setIsProcessing(true);
    try {
      const result = await walletService.unlockContent('chapter', chapter.id, chapter.coin_cost || 0);
      const newBalance = result?.data?.wallet?.availableCoins ?? (user.coin_balance - (chapter.coin_cost || 0));
      dispatch(updateCoinBalance(newBalance));
      setBook({
        ...book,
        chapters: book.chapters.map((ch) =>
          ch.id === chapter.id ? { ...ch, is_unlocked: true } : ch
        ),
      });
      router.push({ pathname: '/reader/[id]', params: { id: book.id, chapterId: chapter.id } });
    } catch {
      Alert.alert(
        'Unable to Unlock',
        'We could not unlock this chapter. You may not have enough coins, or something went wrong. Please try again.'
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleWishlist = async () => {
    if (!book) return;
    const contentType = (book as any).book_content_type === 'audiobook' ? 'audiobook' : 'book';
    if (inWishlist) {
      dispatch(removeFromWishlist(book.id));
      try { await contentService.removeFromWishlist('', book.id); } catch {}
    } else {
      dispatch(addToWishlist(book));
      try { await contentService.addToWishlist('', book.id, contentType as any); } catch {}
    }
  };

  const getRazorpayHtml = (): string => {
    if (!razorpayOrder) return '';
    const keyId = razorpayOrder.key_id;
    const amount = razorpayOrder.amount.toString();
    const currency = razorpayOrder.currency;
    const bookTitle = razorpayOrder.book_title.replace(/"/g, '\\"');
    const orderId = razorpayOrder.order_id;
    const callbackUrl = (razorpayOrder.callback_url || '').replace(/"/g, '\\"');
    const userName = (user?.name || '').replace(/"/g, '\\"');
    const userPhone = user?.mobile_number || '';
    // Server-driven flow: pass callback_url so Razorpay POSTs the result
    // directly to our backend. The backend verifies + persists, then redirects
    // the WebView to the sentinel URL which `onShouldStartLoadWithRequest`
    // intercepts to navigate the host app. No client-side race possible.
    const useCallback = !!callbackUrl;

    return `<!DOCTYPE html>
<html>
<head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="background:#000;margin:0;">
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
  var options = {
    key: "${keyId}",
    amount: "${amount}",
    currency: "${currency}",
    name: "Salil Javeri",
    description: "${bookTitle}",
    order_id: "${orderId}",
    ${useCallback ? `callback_url: "${callbackUrl}",\n    redirect: true,` : 'redirect: false,'}
    handler: function(response) {
      // Backup path: if Razorpay calls the JS handler instead of redirecting,
      // we still notify the host app so it can fall back to client-side verify.
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'PAYMENT_SUCCESS',
        data: {
          razorpay_order_id: response.razorpay_order_id,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_signature: response.razorpay_signature
        }
      }));
    },
    modal: {
      confirm_close: false,
      escape: false,
      ondismiss: function() {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'PAYMENT_FAILED', error: 'dismissed' }));
      }
    },
    prefill: { name: "${userName}", contact: "${userPhone}" },
    theme: { color: "#FF6B6B" }
  };
  var rzp = new Razorpay(options);
  rzp.on('payment.failed', function(response) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'PAYMENT_FAILED', error: response.error.description }));
  });
  rzp.open();
</script>
</body>
</html>`;
  };

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    cover: { width: 120, height: 180, borderRadius: 12, backgroundColor: colors.backgroundCard },
    header: { padding: spacing.md, flexDirection: 'row' },
    headerInfo: { flex: 1, marginLeft: spacing.md },
    title: { ...typography.h2, color: colors.text, marginBottom: spacing.sm },
    author: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
    meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    rating: { flexDirection: 'row', alignItems: 'center' },
    ratingText: { ...typography.body, color: colors.text, marginLeft: 4 },
    reviewsText: { ...typography.bodySmall, color: colors.textSecondary, marginLeft: 4 },
    accessBadge: { backgroundColor: colors.primary, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: 6 },
    accessText: { ...typography.caption, color: '#fff', fontWeight: 'bold' as const },
    actions: { paddingHorizontal: spacing.md, marginBottom: spacing.lg, gap: spacing.sm },
    mainButton: {},
    iconButton: { position: 'absolute' as const, right: spacing.md, bottom: 0, width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
    buyButton: {
      backgroundColor: '#F59E0B',
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    buyButtonText: { ...typography.body, color: '#fff', fontWeight: 'bold' as const, fontSize: 16 },
    couponRow: { flexDirection: 'row' as const, gap: 8 },
    couponInput: {
      flex: 1,
      borderWidth: 1,
      borderColor: '#d1d5db',
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 14,
      color: colors.text,
      backgroundColor: colors.surface,
      letterSpacing: 1,
    },
    couponApplyBtn: {
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingHorizontal: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    couponApplyText: { color: '#fff', fontWeight: 'bold' as const, fontSize: 14 },
    couponApplied: {
      flexDirection: 'row' as const,
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: '#f0fdf4',
      borderWidth: 1,
      borderColor: '#bbf7d0',
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    couponAppliedLeft: { flexDirection: 'row' as const, alignItems: 'center', gap: 6 },
    couponAppliedCode: { fontWeight: 'bold' as const, fontSize: 13, color: '#16a34a' },
    couponAppliedSaving: { fontSize: 13, color: '#16a34a' },
    priceSummary: { flexDirection: 'row' as const, alignItems: 'center', gap: 10, paddingHorizontal: 4 },
    priceOriginal: { fontSize: 15, color: '#9ca3af', textDecorationLine: 'line-through' as const },
    priceFinal: { fontSize: 18, fontWeight: 'bold' as const, color: colors.text },
    section: { paddingHorizontal: spacing.md, marginBottom: spacing.lg },
    sectionTitle: { ...typography.h3, color: colors.text, marginBottom: spacing.md },
    description: { ...typography.body, color: colors.textSecondary, lineHeight: 24 },
    detail: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
    detailLabel: { ...typography.body, color: colors.textSecondary },
    detailValue: { ...typography.body, color: colors.text },
    chapterItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
    chapterOrder: { ...typography.body, color: colors.primary, fontWeight: 'bold' as const, width: 40 },
    chapterTitleContainer: { flex: 1, flexDirection: 'row', alignItems: 'center' },
    chapterTitle: { ...typography.body, color: colors.text, flex: 1 },
    chapterMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    chapterCost: { ...typography.caption, color: colors.accent, fontWeight: 'bold' as const },
    unlockedIcon: { marginRight: spacing.sm },
    unlockButton: { backgroundColor: colors.primary, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: 6 },
    unlockButtonText: { ...typography.caption, color: '#fff', fontWeight: 'bold' as const },
    errorContainer: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
    errorText: { ...typography.h3, color: colors.textSecondary },
    modalContainer: { flex: 1, backgroundColor: '#000' },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: spacing.md,
      backgroundColor: '#111',
    },
    modalTitle: { ...typography.body, color: '#fff', fontWeight: 'bold' as const },
    closeButton: { padding: spacing.sm },
    webview: { flex: 1 },
    loadingOverlay: {
      position: 'absolute',
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.6)',
      alignItems: 'center',
      justifyContent: 'center',
    },
  }), [colors]);

  if (loading) return <LoadingScreen />;

  if (!book) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>Book not found</Text>
      </View>
    );
  }

  const isFreeOrPurchased = book.access_type === AccessType.FREE || isPurchased;
  const isPaid = book.access_type === AccessType.PAID && !isPurchased;
  const labels = getContentSectionLabels(book.language);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView>
        <View style={styles.header}>
          <Image
            source={book.cover_image ? { uri: book.cover_image } : require('../../assets/images/icon.png')}
            style={styles.cover}
          />
          <View style={styles.headerInfo}>
            <Text style={styles.title}>{book.title}</Text>
            <Text style={styles.author}>by {book.author_name}</Text>
            <View style={styles.meta}>
              <View style={styles.rating}>
                <Ionicons name="star" size={16} color={colors.accent} />
                <Text style={styles.ratingText}>{(book.rating ?? 0).toFixed(1)}</Text>
                <Text style={styles.reviewsText}>({book.reviews_count})</Text>
              </View>
              <View style={styles.accessBadge}>
                <Text style={styles.accessText}>
                  {book.access_type === AccessType.FREE
                    ? 'FREE'
                    : book.access_type === AccessType.PAID
                    ? isPurchased
                      ? 'PURCHASED'
                      : (IS_IOS && iapPrice) ? iapPrice : `₹${book.price_inr ?? 0}`
                    : book.access_type === AccessType.COINS
                    ? `${book.coin_price} COINS`
                    : book.access_type === AccessType.PREMIUM
                    ? 'PREMIUM'
                    : 'SUBSCRIPTION'}
                </Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.actions}>
          {isFreeOrPurchased ? (
            <Button
              title={book.book_content_type === 'audiobook' ? 'Play Now' : 'Read Now'}
              onPress={handleRead}
              style={styles.mainButton}
            />
          ) : (
            <>
              {/* Coupon input — Android/web only; coupons unlocking paid content
                  are not allowed on iOS (guideline 3.1.1) */}
              {IS_IOS ? null : !appliedCoupon ? (
                <View style={styles.couponRow}>
                  <TextInput
                    style={styles.couponInput}
                    placeholder="Enter coupon code"
                    placeholderTextColor="#999"
                    value={couponInput}
                    onChangeText={t => setCouponInput(t)}
                    autoCapitalize="none"
                    returnKeyType="done"
                    onSubmitEditing={handleApplyCoupon}
                  />
                  <TouchableOpacity
                    style={styles.couponApplyBtn}
                    onPress={handleApplyCoupon}
                    disabled={couponLoading || !couponInput.trim()}
                    activeOpacity={0.8}
                  >
                    {couponLoading
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={styles.couponApplyText}>Apply</Text>}
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.couponApplied}>
                  <View style={styles.couponAppliedLeft}>
                    <Ionicons name="pricetag" size={14} color="#16a34a" />
                    <Text style={styles.couponAppliedCode}>{appliedCoupon.code}</Text>
                    <Text style={styles.couponAppliedSaving}>-₹{appliedCoupon.discountAmount}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setAppliedCoupon(null)}>
                    <Ionicons name="close-circle" size={18} color="#999" />
                  </TouchableOpacity>
                </View>
              )}

              {/* Price summary */}
              {!IS_IOS && appliedCoupon && (
                <View style={styles.priceSummary}>
                  <Text style={styles.priceOriginal}>₹{book.price_inr ?? 0}</Text>
                  <Text style={styles.priceFinal}>₹{appliedCoupon.finalAmount}</Text>
                </View>
              )}

              {/* Buy button row with wishlist */}
              <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
                <TouchableOpacity
                  style={[styles.buyButton, { flex: 1 }]}
                  onPress={handleBuy}
                  disabled={purchaseLoading}
                  activeOpacity={0.85}
                >
                  {purchaseLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.buyButtonText}>
                      {IS_IOS
                        ? `Buy ${iapPrice ?? `₹${book.price_inr ?? 0}`}`
                        : `Buy ₹${appliedCoupon ? appliedCoupon.finalAmount : (book.price_inr ?? 0)}`}
                    </Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }} onPress={handleWishlist}>
                  <Ionicons name={inWishlist ? 'heart' : 'heart-outline'} size={32} color={colors.primary} />
                </TouchableOpacity>
              </View>

              {/* Apple requires a Restore Purchases option for non-consumables */}
              {IS_IOS && (
                <TouchableOpacity onPress={handleRestorePurchases} disabled={restoreLoading} style={{ alignItems: 'center', paddingVertical: spacing.sm }}>
                  {restoreLoading ? (
                    <ActivityIndicator color={colors.primary} size="small" />
                  ) : (
                    <Text style={{ ...typography.bodySmall, color: colors.primary }}>Restore Purchases</Text>
                  )}
                </TouchableOpacity>
              )}
            </>
          )}
          {isFreeOrPurchased && (
            <TouchableOpacity style={{ position: 'absolute', right: spacing.md, top: 0, width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }} onPress={handleWishlist}>
              <Ionicons name={inWishlist ? 'heart' : 'heart-outline'} size={32} color={colors.primary} />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{labels.description}</Text>
          <Text style={styles.description}>{book.description}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{labels.details}</Text>
          <View style={styles.detail}>
            <Text style={styles.detailLabel}>Language</Text>
            <Text style={styles.detailValue}>{book.language}</Text>
          </View>
          <View style={styles.detail}>
            <Text style={styles.detailLabel}>{labels.chapters}</Text>
            <Text style={styles.detailValue}>{book.chapters.length}</Text>
          </View>
        </View>

        {book.chapters.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{labels.chapters}</Text>
            {book.chapters.map((chapter, index) => (
              <TouchableOpacity
                key={chapter.id}
                style={styles.chapterItem}
                onPress={() => handleChapterPress(chapter, index)}
                activeOpacity={0.7}
                disabled={isProcessing || purchaseLoading}
              >
                <Text style={styles.chapterOrder}>{index+1}</Text>
                <View style={styles.chapterTitleContainer}>
                  <Text style={styles.chapterTitle} numberOfLines={1}>{chapter.title}</Text>
                </View>
                <View style={styles.chapterMeta}>
                  {book.book_content_type === 'audiobook' ? (
                    // Audiobook chapter — show play or lock
                    isFreeOrPurchased
                      ? <Ionicons name="play-circle" size={30} color={colors.primary} />
                      : <Ionicons name="lock-closed" size={18} color={colors.textSecondary} />
                  ) : (
                    // Ebook chapter
                    <>
                      {(isPurchased || chapter.is_unlocked === true || chapter.is_free) ? (
                        <Ionicons name="lock-open" size={16} color={colors.success} style={styles.unlockedIcon} />
                      ) : (
                        <>
                          {chapter.coin_cost && book.access_type !== AccessType.PAID ? (
                            <TouchableOpacity
                              style={styles.unlockButton}
                              onPress={(e) => { e.stopPropagation?.(); unlockChapter(chapter); }}
                              disabled={isProcessing}
                            >
                              <Text style={styles.unlockButtonText}>{chapter.coin_cost} Unlock</Text>
                            </TouchableOpacity>
                          ) : (
                            <Ionicons name="lock-closed" size={16} color={colors.textSecondary} />
                          )}
                        </>
                      )}
                      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                    </>
                  )}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {isPurchased && (
          <View style={styles.section}>
            <ReviewSection bookId={id} />
          </View>
        )}
      </ScrollView>

      {/* Overlay while we either talk to the backend before opening the SDK,
          or while verifying the payment afterward. The native checkout has
          its own UI — we never render a WebView modal anymore. */}
      {purchaseLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}
    </SafeAreaView>
  );
}
