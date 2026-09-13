import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useState } from 'react';
import { AuthProvider, type AuthSession, type VerifiedProfile } from '../src/services/authSession';
import { registerConfiguredReminderHeadlessTask } from '../src/services/configuredReminderHeadless';
import { runtimeConfig } from '../src/config/runtime';
import { createApiClient } from '../src/services/apiClient';
import * as SecureStore from 'expo-secure-store';
import { createReminderScheduler } from '../src/services/reminderScheduler';
import { configureReminderRuntime, ReminderRuntimeOwner } from '../src/services/reminderRuntime';
import { openQingmuRepository } from '../src/storage/mobileDatabase';
import { randomUUID } from 'expo-crypto';

void registerConfiguredReminderHeadlessTask();

export default function RootLayout() {
  const [reminderScheduler] = useState(() => createReminderScheduler());
  const [reminderRuntime] = useState(() => new ReminderRuntimeOwner({
    scheduler: reminderScheduler,
    secureStore: SecureStore,
    createApiClient: (session) => createApiClient({ baseUrl: runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL }).apiBaseUrl, token: session.sessionToken, memberId: session.memberId }),
    loadNotificationSource: async () => {
      const notifications = await import('expo-notifications');
      return notifications;
    },
    generateInstallationId: randomUUID,
    getCompletionStatus: (memberId, taskDate) => {
      try { return openQingmuRepository().get({ memberId, planId: 'church-2026-09', taskDate })?.status ?? null; } catch { return null; }
    },
  }));
  const loadProfile = useCallback(async (session: AuthSession): Promise<VerifiedProfile | null> => {
    const config = runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL });
    return createApiClient({ baseUrl: config.apiBaseUrl, token: session.sessionToken, memberId: session.memberId }).getProfile();
  }, []);
  configureReminderRuntime(reminderRuntime);
  return <AuthProvider loadProfile={loadProfile}><StatusBar style="dark" /><Stack screenOptions={{ headerShown: false }} /></AuthProvider>;
}
