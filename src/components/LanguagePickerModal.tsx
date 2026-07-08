import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

export const SUPPORTED_LANGUAGES = [
  { code: 'all', label: 'All Languages', native: 'All' },
  { code: 'English', label: 'English', native: 'English' },
  { code: 'Hindi', label: 'Hindi', native: 'हिन्दी' },
  { code: 'Marathi', label: 'Marathi', native: 'मराठी' },
  { code: 'Gujarati', label: 'Gujarati', native: 'ગુજરાતી' },
] as const;

export type LanguageCode = typeof SUPPORTED_LANGUAGES[number]['code'];

interface Props {
  visible: boolean;
  current: LanguageCode | null;
  /** If true, user cannot dismiss without picking — used for first-launch flow. */
  required?: boolean;
  onSelect: (code: LanguageCode) => void;
  onClose?: () => void;
}

export function LanguagePickerModal({ visible, current, required, onSelect, onClose }: Props) {
  const { colors } = useTheme();

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={() => {
        if (!required) onClose?.();
      }}
    >
      <View style={s.backdrop}>
        <View style={[s.card, { backgroundColor: colors.background, borderColor: colors.border }]}>
          {!required && onClose ? (
            <TouchableOpacity style={s.closeBtn} onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          ) : null}

          <Text style={[s.title, { color: colors.text }]}>
            {required ? 'Choose your language' : 'Change language'}
          </Text>
          <Text style={[s.subtitle, { color: colors.textSecondary }]}>
            We'll show books and audiobooks in this language. You can change this anytime from the home page.
          </Text>

          <View style={s.list}>
            {SUPPORTED_LANGUAGES.map((lang) => {
              const isActive = current === lang.code;
              return (
                <TouchableOpacity
                  key={lang.code}
                  style={[
                    s.row,
                    {
                      backgroundColor: isActive ? colors.primary + '18' : colors.backgroundCard,
                      borderColor: isActive ? colors.primary : colors.border,
                    },
                  ]}
                  activeOpacity={0.8}
                  onPress={() => onSelect(lang.code)}
                >
                  <View style={s.rowText}>
                    <Text style={[s.rowLabel, { color: colors.text }]}>{lang.label}</Text>
                    {lang.native !== lang.label ? (
                      <Text style={[s.rowNative, { color: colors.textSecondary }]}>{lang.native}</Text>
                    ) : null}
                  </View>
                  {isActive ? (
                    <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
                  ) : (
                    <Ionicons name="ellipse-outline" size={22} color={colors.textMuted ?? colors.textSecondary} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg + 4,
    paddingBottom: spacing.lg,
    ...Platform.select({
      android: { elevation: 8 },
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.25,
        shadowRadius: 16,
      },
    }),
  },
  closeBtn: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    padding: 6,
    zIndex: 1,
  },
  title: { ...typography.h3, fontWeight: '700' as const, marginBottom: 6 },
  subtitle: { ...typography.bodySmall, marginBottom: spacing.md },
  list: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
  },
  rowText: { flexShrink: 1 },
  rowLabel: { ...typography.body, fontWeight: '600' as const },
  rowNative: { ...typography.bodySmall, marginTop: 2 },
});
