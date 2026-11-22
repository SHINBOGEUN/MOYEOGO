import type { SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import Storage from 'expo-sqlite/kv-store';
import { Platform } from 'react-native';

const tokenStorageKey = 'moyeogo:expo-push-token:v1';
const pendingTokenStorageKey = 'moyeogo:expo-push-token-pending:v1';
export const friendNotificationChannel = 'friend-updates';

type StoredPushToken = { userId: string; token: string };

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function storedToken(): Promise<StoredPushToken | null> {
  const raw = await Storage.getItem(tokenStorageKey);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredPushToken;
    return typeof parsed.userId === 'string' && typeof parsed.token === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export async function unregisterPushToken(client: SupabaseClient): Promise<void> {
  const stored = await storedToken();
  const pending = await Storage.getItem(pendingTokenStorageKey);
  for (const token of new Set([stored?.token, pending].filter((value): value is string => Boolean(value)))) {
    const { error } = await client.rpc('unregister_my_push_token', { push_token: token });
    if (error) throw error;
    if (stored?.token === token) await Storage.removeItem(tokenStorageKey);
    if (pending === token) await Storage.removeItem(pendingTokenStorageKey);
  }
}

export async function clearStalePushToken(client: SupabaseClient, currentUserId: string): Promise<void> {
  const previous = await storedToken();
  const pending = await Storage.getItem(pendingTokenStorageKey);
  if (pending || (previous && previous.userId !== currentUserId)) await unregisterPushToken(client);
}

export async function registerPushToken(client: SupabaseClient, userId: string): Promise<'registered' | 'permission-denied'> {
  await clearStalePushToken(client, userId);
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return 'permission-denied';
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(friendNotificationChannel, {
      name: '친구 알림',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL) {
    permission = await Notifications.requestPermissionsAsync();
  }
  if (!permission.granted && permission.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return 'permission-denied';
  }

  const projectId = Constants.easConfig?.projectId
    ?? Constants.expoConfig?.extra?.eas?.projectId
    ?? process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  if (!projectId) throw new Error('EAS project ID is required for push notifications');
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  const old = await storedToken();
  if (old?.userId === userId && old.token !== token) {
    const { error } = await client.rpc('unregister_my_push_token', { push_token: old.token });
    if (error) throw error;
    await Storage.removeItem(tokenStorageKey);
  }
  await Storage.setItem(pendingTokenStorageKey, token);
  const { error } = await client.rpc('register_my_push_token', { push_token: token, platform: Platform.OS });
  if (error) {
    // The server may have saved this token even if its response was lost.
    // Keep it so logout or the next registration can remove the server row.
    throw error;
  }
  await Storage.setItem(tokenStorageKey, JSON.stringify({ userId, token } satisfies StoredPushToken));
  await Storage.removeItem(pendingTokenStorageKey);
  return 'registered';
}
