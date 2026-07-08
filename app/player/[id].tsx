import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Alert,
  Modal,
  ScrollView,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { colors } from '../../src/theme/colors';
import { typography } from '../../src/theme/typography';
import { spacing } from '../../src/theme/spacing';
import { contentService } from '../../src/services/content.service';
import { Content } from '../../src/types';
import { useAudioPlayer } from '../../src/context/AudioPlayerContext';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const COVER_SIZE = SCREEN_WIDTH - 80;

function formatTime(seconds: number): string {
  const s = Math.max(0, seconds || 0);
  const mins = Math.floor(s / 60);
  const secs = Math.floor(s % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default function PlayerScreen() {
  const { id, chapterIndex } = useLocalSearchParams<{ id: string; chapterIndex?: string }>();
  const router = useRouter();
  const { trackInfo, isPlaying, isBuffering, isReady, position, duration, setQueueForBook, skipToChapter, togglePlayback, seekTo, skipBy, setRate } = useAudioPlayer();

  const [audiobook, setAudiobook] = useState<Content | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [isLoading, setIsLoading] = useState(true);
  const [showChapters, setShowChapters] = useState(false);
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const loadedRef = useRef(false);

  const currentChapterIdx = trackInfo?.bookId === id ? trackInfo.chapterIndex : 0;

  useEffect(() => {
    if (!isReady || loadedRef.current) return;
    loadedRef.current = true;
    loadAudiobook();
  }, [id, isReady]);

  const loadAudiobook = async () => {
    try {
      const data = await contentService.getAudiobookById(id);
      setAudiobook(data);

      const requestedIndex = chapterIndex !== undefined ? parseInt(chapterIndex, 10) : 0;
      const hasAudio = data.chapters?.some((ch) => ch.audio_url);
      if (!hasAudio) {
        setIsLoading(false);
        return;
      }

      const alreadyPlayingThisBook = trackInfo?.bookId === id;
      const alreadyAtRequestedChapter = alreadyPlayingThisBook && trackInfo?.chapterIndex === requestedIndex;

      if (alreadyAtRequestedChapter) {
        // Coming back to the same chapter — don't disturb playback
      } else if (alreadyPlayingThisBook) {
        await skipToChapter(requestedIndex);
      } else {
        await setQueueForBook({
          bookId: id,
          bookTitle: data.title,
          author: data.author_name,
          coverImage: data.cover_image,
          chapters: data.chapters || [],
        }, requestedIndex);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to load audiobook');
    } finally {
      setIsLoading(false);
    }
  };

  const totalChapters = audiobook?.chapters?.length ?? 0;
  const currentChapter = audiobook?.chapters?.[currentChapterIdx];

  const displayPosition = scrubbing ?? position;
  const progress = duration > 0 ? displayPosition / duration : 0;

  const handlePrev = async () => {
    if (currentChapterIdx > 0) await skipToChapter(currentChapterIdx - 1);
  };
  const handleNext = async () => {
    if (currentChapterIdx < totalChapters - 1) await skipToChapter(currentChapterIdx + 1);
  };

  const cycleSpeed = async () => {
    const speeds = [1.0, 1.25, 1.5, 1.75, 2.0];
    const nextIndex = (speeds.indexOf(playbackSpeed) + 1) % speeds.length;
    const newSpeed = speeds[nextIndex];
    setPlaybackSpeed(newSpeed);
    await setRate(newSpeed);
  };

  if (isLoading || !audiobook) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="chevron-down" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerLabel}>NOW PLAYING</Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {currentChapter ? `${currentChapter.order} of ${totalChapters}` : ''}
          </Text>
        </View>
        <TouchableOpacity style={styles.headerBtn} onPress={() => setShowChapters(true)}>
          <Ionicons name="list" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <View style={styles.coverWrapper}>
        <View style={styles.coverShadow}>
          <Image
            source={
              currentChapter?.chapter_image
                ? { uri: currentChapter.chapter_image }
                : audiobook.cover_image
                ? { uri: audiobook.cover_image }
                : require('../../assets/images/icon.png')
            }
            style={styles.cover}
          />
        </View>
        <View style={styles.dots}>
          {audiobook.chapters.map((_, idx) => (
            <View key={idx} style={[styles.dot, idx === currentChapterIdx && styles.dotActive]} />
          ))}
        </View>
      </View>

      <View style={styles.infoRow}>
        <View style={styles.infoText}>
          <Text style={styles.title} numberOfLines={1}>{audiobook.title}</Text>
          <Text style={styles.chapterName} numberOfLines={1}>
            {currentChapter?.title ?? audiobook.author_name}
          </Text>
        </View>
        <TouchableOpacity onPress={cycleSpeed} style={styles.speedPill}>
          <Text style={styles.speedText}>{playbackSpeed}x</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.progressContainer}>
        <Slider
          style={styles.slider}
          value={displayPosition}
          minimumValue={0}
          maximumValue={duration || 1}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.backgroundElevated}
          thumbTintColor={colors.primary}
          onValueChange={(v) => setScrubbing(v)}
          onSlidingComplete={async (v) => {
            await seekTo(v);
            setScrubbing(null);
          }}
        />
        <View style={styles.timeRow}>
          <Text style={styles.timeText}>{formatTime(displayPosition)}</Text>
          <Text style={styles.timeRemain}>-{formatTime(Math.max(0, duration - displayPosition))}</Text>
        </View>
      </View>

      <View style={styles.controls}>
        <TouchableOpacity onPress={() => skipBy(-15)} style={styles.skipBtn}>
          <Ionicons name="play-back-outline" size={28} color={colors.text} />
          <Text style={styles.skipLabel}>15</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handlePrev}
          style={[styles.navBtn, currentChapterIdx === 0 && styles.navBtnDisabled]}
          disabled={currentChapterIdx === 0}
          activeOpacity={0.7}
        >
          <Ionicons name="play-skip-back" size={28} color="#FFFFFF" />
        </TouchableOpacity>

        <TouchableOpacity onPress={togglePlayback} style={styles.playButton} disabled={isBuffering}>
          {isBuffering ? (
            <ActivityIndicator color="#fff" size="large" />
          ) : (
            <Ionicons name={isPlaying ? 'pause' : 'play'} size={36} color="#fff" />
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleNext}
          style={[styles.navBtn, currentChapterIdx >= totalChapters - 1 && styles.navBtnDisabled]}
          disabled={currentChapterIdx >= totalChapters - 1}
          activeOpacity={0.7}
        >
          <Ionicons name="play-skip-forward" size={28} color="#FFFFFF" />
        </TouchableOpacity>

        <TouchableOpacity onPress={() => skipBy(15)} style={styles.skipBtn}>
          <Ionicons name="play-forward-outline" size={28} color={colors.text} />
          <Text style={styles.skipLabel}>15</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.bottomBar}>
        <View style={styles.progressBarThin}>
          <View style={[styles.progressBarFill, { width: `${progress * 100}%` }]} />
        </View>
        <Text style={styles.authorText}>by {audiobook.author_name}</Text>
      </View>

      <Modal visible={showChapters} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Chapters</Text>
              <TouchableOpacity onPress={() => setShowChapters(false)} style={styles.closeBtn}>
                <Ionicons name="close" size={20} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {audiobook.chapters.map((ch, idx) => (
                <TouchableOpacity
                  key={ch.id}
                  style={[styles.chapterRow, idx === currentChapterIdx && styles.chapterRowActive]}
                  onPress={() => {
                    if (ch.audio_url) {
                      skipToChapter(idx);
                      setShowChapters(false);
                    }
                  }}
                  disabled={!ch.audio_url}
                >
                  <View style={[styles.chapterNumBadge, idx === currentChapterIdx && styles.chapterNumBadgeActive]}>
                    <Text style={[styles.chapterRowNum, idx === currentChapterIdx && styles.chapterRowNumActive]}>
                      {ch.order}
                    </Text>
                  </View>
                  <View style={styles.chapterRowInfo}>
                    <Text style={[styles.chapterRowTitle, !ch.audio_url && styles.chapterRowDisabled]}>
                      {ch.title}
                    </Text>
                  </View>
                  {ch.audio_url ? (
                    <Ionicons
                      name={idx === currentChapterIdx ? 'volume-high' : 'play-circle-outline'}
                      size={20}
                      color={idx === currentChapterIdx ? colors.primary : colors.textMuted}
                    />
                  ) : (
                    <Ionicons name="lock-closed-outline" size={18} color={colors.textDim} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  headerBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    color: colors.textMuted,
  },
  headerSub: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },

  coverWrapper: {
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingVertical: spacing.lg,
  },
  coverShadow: {
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 20,
    borderRadius: 20,
  },
  cover: {
    width: COVER_SIZE,
    height: COVER_SIZE,
    borderRadius: 20,
    backgroundColor: colors.backgroundCard,
  },
  dots: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 5,
    alignItems: 'center',
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.backgroundElevated,
  },
  dotActive: {
    width: 20,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },

  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.md,
  },
  infoText: {
    flex: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  chapterName: {
    ...typography.bodySmall,
    color: colors.primary,
  },
  speedPill: {
    backgroundColor: colors.backgroundElevated,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  speedText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },

  progressContainer: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  slider: {
    width: '100%',
    height: 36,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -4,
  },
  timeText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  timeRemain: {
    fontSize: 12,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },

  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.lg,
  },
  skipBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 48,
  },
  skipLabel: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 2,
    fontWeight: '600',
  },
  navBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.backgroundElevated,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  navBtnDisabled: {
    opacity: 0.35,
  },
  playButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 12,
  },

  bottomBar: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
    alignItems: 'center',
    gap: 8,
  },
  progressBarThin: {
    width: '100%',
    height: 2,
    backgroundColor: colors.backgroundElevated,
    borderRadius: 1,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 2,
    backgroundColor: colors.primary,
    borderRadius: 1,
  },
  authorText: {
    ...typography.caption,
    color: colors.textDim,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: colors.backgroundCard,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '72%',
    paddingBottom: 40,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderLight,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.backgroundElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chapterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  chapterRowActive: {
    backgroundColor: 'rgba(255,107,107,0.06)',
  },
  chapterNumBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.backgroundElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chapterNumBadgeActive: {
    backgroundColor: colors.primary,
  },
  chapterRowNum: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
  },
  chapterRowNumActive: {
    color: '#fff',
  },
  chapterRowInfo: {
    flex: 1,
    marginLeft: 12,
  },
  chapterRowTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  chapterRowDisabled: {
    color: colors.textDim,
  },
});
