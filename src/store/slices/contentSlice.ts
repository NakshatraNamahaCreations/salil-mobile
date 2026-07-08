import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { contentService } from '../../services/content.service';
import { Content, Banner, Progress } from '../../types';

const HOME_CACHE_KEY = '@ebook_home_data';
const HOME_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface ContentState {
  banners: Banner[];
  trendingBooks: Content[];
  trendingAudiobooks: Content[];
  trendingPodcasts: Content[];
  library: Content[];
  wishlist: Content[];
  progress: Progress[];
  isLoading: boolean;
  error: string | null;
}

const initialState: ContentState = {
  banners: [],
  trendingBooks: [],
  trendingAudiobooks: [],
  trendingPodcasts: [],
  library: [],
  wishlist: [],
  progress: [],
  isLoading: false,
  error: null,
};

type FetchHomeArg = boolean | { forceRefresh?: boolean; language?: string | null };

export const fetchHomeData = createAsyncThunk('content/fetchHomeData', async (arg?: FetchHomeArg) => {
  const forceRefresh =
    typeof arg === 'boolean' ? arg : !!arg?.forceRefresh;
  const language =
    typeof arg === 'object' && arg !== null ? (arg.language || null) : null;

  const cacheKey = language ? `${HOME_CACHE_KEY}:${language}` : HOME_CACHE_KEY;

  // Return cached data if it's fresh (unless user explicitly pulls to refresh)
  if (!forceRefresh) {
    try {
      const raw = await AsyncStorage.getItem(cacheKey);
      if (raw) {
        const { data, ts } = JSON.parse(raw);
        if (Date.now() - ts < HOME_CACHE_TTL) {
          return data; // instant — no network calls
        }
      }
    } catch {}
  }

  // Build base content params; only pass language if user picked one (not "all")
  const langParam = language && language !== 'all' ? { language } : {};

  // Fetch fresh data from network
  const [banners, allBooks, trendingAudiobooks, trendingPodcasts] =
    await Promise.all([
      contentService.getBanners(),
      contentService.getContent({ content_type: 'book' as any, limit: 20, ...langParam }),
      contentService.getContent({ content_type: 'audiobook' as any, limit: 10, ...langParam }),
      contentService.getContent({ content_type: 'podcast' as any, limit: 10, ...langParam }),
    ]);

  const trendingBooks = allBooks.filter(
    (b: any) => !b.book_content_type || b.book_content_type === 'ebook'
  ).slice(0, 10);

  const trendingAudiobooksFiltered = trendingAudiobooks.filter(
    (b: any) => b.book_content_type === 'audiobook' || b.content_type === 'audiobook'
  );

  const result = { banners, trendingBooks, trendingAudiobooks: trendingAudiobooksFiltered, trendingPodcasts };

  // Save to cache with timestamp (per-language)
  try {
    await AsyncStorage.setItem(cacheKey, JSON.stringify({ data: result, ts: Date.now() }));
  } catch {}

  return result;
});

export const fetchLibrary = createAsyncThunk('content/fetchLibrary', async (userId: string) => {
  const result = await contentService.getUserLibrary(userId, 1, 100);
  return result.data;
});

export const fetchWishlist = createAsyncThunk('content/fetchWishlist', async (userId: string) => {
  const result = await contentService.getWishlist(userId, 1, 100);
  return result.data;
});

export const fetchProgress = createAsyncThunk('content/fetchProgress', async (userId: string) => {
  return await contentService.getProgress(userId) as Progress[];
});

const contentSlice = createSlice({
  name: 'content',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    addToWishlist: (state, action: PayloadAction<Content>) => {
      if (!state.wishlist.find((item) => item.id === action.payload.id)) {
        state.wishlist.push(action.payload);
      }
    },
    removeFromWishlist: (state, action: PayloadAction<string>) => {
      state.wishlist = state.wishlist.filter((item) => item.id !== action.payload);
    },
    addToLibrary: (state, action: PayloadAction<Content>) => {
      if (!state.library.find((item) => item.id === action.payload.id)) {
        state.library.push(action.payload);
      }
    },
    removeFromLibrary: (state, action: PayloadAction<string>) => {
      state.library = state.library.filter((item) => item.id !== action.payload);
    },
    resetContent: () => initialState,
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchHomeData.pending, (state) => {
        state.isLoading = true;
      })
      .addCase(fetchHomeData.fulfilled, (state, action) => {
        state.isLoading = false;
        state.banners = action.payload.banners;
        state.trendingBooks = action.payload.trendingBooks;
        state.trendingAudiobooks = action.payload.trendingAudiobooks;
        state.trendingPodcasts = action.payload.trendingPodcasts;
      })
      .addCase(fetchHomeData.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to load content';
      })
      .addCase(fetchLibrary.fulfilled, (state, action) => {
        state.library = action.payload;
      })
      .addCase(fetchWishlist.fulfilled, (state, action) => {
        state.wishlist = action.payload;
      })
      .addCase(fetchProgress.fulfilled, (state, action) => {
        state.progress = action.payload;
      });
  },
});

export const { clearError, addToWishlist, removeFromWishlist, addToLibrary, removeFromLibrary, resetContent } = contentSlice.actions;
export default contentSlice.reducer;
