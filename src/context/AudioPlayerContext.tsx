import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Audio, AVPlaybackStatus, AVPlaybackStatusSuccess, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import type { Chapter } from '../types';

export interface TrackInfo {
  bookId: string;
  bookTitle: string;
  chapterTitle: string;
  coverImage: string;
  chapterIndex: number;
}

export interface QueueBook {
  bookId: string;
  bookTitle: string;
  author: string;
  coverImage: string;
  chapters: Chapter[];
}

interface AudioPlayerCtx {
  trackInfo: TrackInfo | null;
  isPlaying: boolean;
  isBuffering: boolean;
  isReady: boolean;
  position: number;
  duration: number;
  setQueueForBook: (book: QueueBook, startIndex: number) => Promise<void>;
  skipToChapter: (index: number) => Promise<void>;
  togglePlayback: () => Promise<void>;
  stop: () => Promise<void>;
  seekTo: (positionSeconds: number) => Promise<void>;
  skipBy: (seconds: number) => Promise<void>;
  setRate: (rate: number) => Promise<void>;
}

const AudioPlayerContext = createContext<AudioPlayerCtx | null>(null);

let audioModeConfigured = false;
async function ensureAudioMode() {
  if (audioModeConfigured) return;
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
    });
    audioModeConfigured = true;
  } catch (e) {
    console.warn('setAudioModeAsync failed', e);
  }
}

function isLoaded(status: AVPlaybackStatus | null): status is AVPlaybackStatusSuccess {
  return !!status && (status as AVPlaybackStatusSuccess).isLoaded === true;
}

export function AudioPlayerProvider({ children }: { children: React.ReactNode }) {
  const [trackInfo, setTrackInfo] = useState<TrackInfo | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const isReady = true;

  const soundRef = useRef<Audio.Sound | null>(null);
  const currentBookRef = useRef<QueueBook | null>(null);
  const currentIdxRef = useRef<number>(0);
  const rateRef = useRef<number>(1.0);

  // Monotonic token. Every load/stop bumps it. A load that finishes after a newer
  // token has been issued is considered stale and is discarded immediately,
  // preventing two Audio.Sound instances from playing in parallel.
  const loadSeqRef = useRef(0);

  // Forward declaration via ref so handlers can call playIndex without ordering issues.
  const playIndexRef = useRef<(idx: number) => Promise<void>>(async () => {});

  const tearDownSound = (s: Audio.Sound | null) => {
    if (!s) return;
    try { s.setOnPlaybackStatusUpdate(null); } catch {}
    s.stopAsync().catch(() => {});
    s.unloadAsync().catch(() => {});
  };

  const onStatus = useCallback((status: AVPlaybackStatus) => {
    if (!isLoaded(status)) return;
    setIsPlaying(!!status.isPlaying);
    // `isBuffering` is true while expo-av is fetching/stalling on the network.
    // Surface it only when nothing is actually playing so the UI can show a
    // spinner instead of looking frozen on slow connections.
    setIsBuffering(!!status.isBuffering && !status.isPlaying && !status.didJustFinish);
    setPosition((status.positionMillis ?? 0) / 1000);
    setDuration((status.durationMillis ?? 0) / 1000);

    if (status.didJustFinish && !status.isLooping) {
      const book = currentBookRef.current;
      if (!book) return;
      let nextIdx = currentIdxRef.current + 1;
      while (nextIdx < book.chapters.length && !book.chapters[nextIdx]?.audio_url) {
        nextIdx++;
      }
      if (nextIdx < book.chapters.length) {
        // Defer the advance to the next tick. Tearing down the just-finished
        // sound from INSIDE its own status callback can deadlock expo-av's
        // native player — this is the "app freezes after a track ends and
        // needs a restart to play the next one" bug. Letting the callback
        // unwind first makes auto-advance reliable.
        const target = nextIdx;
        setTimeout(() => {
          playIndexRef.current(target).catch((e) => console.warn('auto-advance failed', e));
        }, 0);
      } else {
        setIsPlaying(false);
        setIsBuffering(false);
      }
    }
  }, []);

  const playIndex = useCallback(async (idx: number) => {
    const book = currentBookRef.current;
    if (!book) return;
    if (idx < 0 || idx >= book.chapters.length) return;

    const chapter = book.chapters[idx];
    if (!chapter?.audio_url) {
      console.warn('[Audio] chapter has no audio_url', idx);
      return;
    }

    // Claim this load. Any in-flight or upcoming load now sees a stale token.
    const mySeq = ++loadSeqRef.current;

    await ensureAudioMode();

    // Tear down whatever was playing — fire-and-forget so the UI stays snappy.
    const prev = soundRef.current;
    soundRef.current = null;
    tearDownSound(prev);

    // Bail if a newer tap has already arrived while we were preparing.
    if (mySeq !== loadSeqRef.current) return;

    currentIdxRef.current = idx;
    setTrackInfo({
      bookId: book.bookId,
      bookTitle: book.bookTitle,
      chapterTitle: chapter.title,
      coverImage: chapter.chapter_image || book.coverImage,
      chapterIndex: idx,
    });
    setPosition(0);
    setDuration(0);
    setIsBuffering(true);

    let sound: Audio.Sound | undefined;
    try {
      const res = await Audio.Sound.createAsync(
        { uri: chapter.audio_url },
        { shouldPlay: true, rate: rateRef.current, progressUpdateIntervalMillis: 500 },
        onStatus,
      );
      sound = res.sound;
    } catch (e: any) {
      if (mySeq === loadSeqRef.current) {
        console.error('[Audio] load failed', e?.message || e);
        setIsBuffering(false);
      }
      return;
    }

    // A newer load was issued while createAsync was in flight — discard this one.
    if (mySeq !== loadSeqRef.current) {
      tearDownSound(sound);
      return;
    }

    soundRef.current = sound;
  }, [onStatus]);

  useEffect(() => {
    playIndexRef.current = playIndex;
  }, [playIndex]);

  useEffect(() => {
    return () => {
      const s = soundRef.current;
      if (s) {
        try { s.setOnPlaybackStatusUpdate(null); } catch {}
        s.unloadAsync().catch(() => {});
      }
    };
  }, []);

  const setQueueForBook = useCallback(async (book: QueueBook, startIndex: number) => {
    if (book.chapters.length === 0) {
      console.warn('[Audio] book has no chapters');
      return;
    }
    const clampedIndex = Math.max(0, Math.min(startIndex, book.chapters.length - 1));
    const sameBook = currentBookRef.current?.bookId === book.bookId;

    // Keep the FULL chapter list so indexes match the UI / API.
    // Chapters without audio_url are skipped at play time, not removed from the queue.
    currentBookRef.current = book;

    if (sameBook && currentIdxRef.current === clampedIndex && soundRef.current) {
      try { await soundRef.current.playAsync(); } catch {}
      return;
    }

    await playIndex(clampedIndex);
  }, [playIndex]);

  const skipToChapter = useCallback(async (index: number) => {
    const book = currentBookRef.current;
    if (!book) return;
    if (index < 0 || index >= book.chapters.length) return;
    await playIndex(index);
  }, [playIndex]);

  const togglePlayback = useCallback(async () => {
    const s = soundRef.current;
    if (!s) return;
    try {
      const status = await s.getStatusAsync();
      if (!isLoaded(status)) return;
      if (status.isPlaying) {
        await s.pauseAsync();
      } else {
        await s.playAsync();
      }
    } catch (e) {
      console.warn('[Audio] togglePlayback failed', e);
    }
  }, []);

  const stop = useCallback(async () => {
    // Invalidate any in-flight load so it tears itself down on completion.
    ++loadSeqRef.current;
    const prev = soundRef.current;
    soundRef.current = null;
    tearDownSound(prev);
    currentBookRef.current = null;
    currentIdxRef.current = 0;
    setTrackInfo(null);
    setIsPlaying(false);
    setIsBuffering(false);
    setPosition(0);
    setDuration(0);
  }, []);

  const seekTo = useCallback(async (positionSeconds: number) => {
    const s = soundRef.current;
    if (!s) return;
    try {
      await s.setPositionAsync(Math.max(0, positionSeconds * 1000));
    } catch {}
  }, []);

  const skipBy = useCallback(async (seconds: number) => {
    const s = soundRef.current;
    if (!s) return;
    try {
      const status = await s.getStatusAsync();
      if (!isLoaded(status)) return;
      const target = Math.max(
        0,
        Math.min(
          (status.durationMillis ?? 0),
          (status.positionMillis ?? 0) + seconds * 1000,
        ),
      );
      await s.setPositionAsync(target);
    } catch {}
  }, []);

  const setRate = useCallback(async (rate: number) => {
    rateRef.current = rate;
    const s = soundRef.current;
    if (!s) return;
    try {
      await s.setRateAsync(rate, true);
    } catch {}
  }, []);

  return (
    <AudioPlayerContext.Provider value={{
      trackInfo,
      isPlaying,
      isBuffering,
      isReady,
      position,
      duration,
      setQueueForBook,
      skipToChapter,
      togglePlayback,
      stop,
      seekTo,
      skipBy,
      setRate,
    }}>
      {children}
    </AudioPlayerContext.Provider>
  );
}

export function useAudioPlayer() {
  const ctx = useContext(AudioPlayerContext);
  if (!ctx) throw new Error('useAudioPlayer must be inside AudioPlayerProvider');
  return ctx;
}
