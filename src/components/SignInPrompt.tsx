import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { UserCircle } from 'lucide-react-native';
import { Button } from './buttons/Button';
import { typography } from '../theme/typography';
import { spacing } from '../theme/spacing';
import { useTheme } from '../theme/ThemeContext';

interface SignInPromptProps {
  title?: string;
  subtitle?: string;
}

export const SignInPrompt: React.FC<SignInPromptProps> = ({
  title = 'Sign in to continue',
  subtitle = 'Create a free account or sign in to access this feature.',
}) => {
  const router = useRouter();
  const { colors } = useTheme();

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.xl,
      gap: spacing.md,
    },
    title: { ...typography.h2, color: colors.text, textAlign: 'center' },
    subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  }), [colors]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.content}>
        <UserCircle size={64} color={colors.primary} strokeWidth={1.5} />
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        <Button
          title="Sign In / Sign Up"
          onPress={() => router.push('/login')}
          fullWidth
          style={{ marginTop: spacing.md }}
        />
      </View>
    </SafeAreaView>
  );
};
