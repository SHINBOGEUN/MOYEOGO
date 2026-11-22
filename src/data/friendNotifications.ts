import type { SupabaseClient } from '@supabase/supabase-js';

export type FriendNotification = {
  id: string;
  recipient_user_id: string;
  actor_user_id: string;
  actor_nickname: string;
  kind: 'friend_request' | 'friend_accepted';
  source_request_id: string;
  created_at: string;
  read_at: string | null;
};

export async function loadFriendNotifications(client: SupabaseClient): Promise<FriendNotification[]> {
  const { data, error } = await client
    .from('friend_notifications')
    .select('id,recipient_user_id,actor_user_id,actor_nickname,kind,source_request_id,created_at,read_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as FriendNotification[];
}

export async function markFriendNotificationRead(client: SupabaseClient, notificationId: string): Promise<void> {
  const { error } = await client.rpc('mark_my_friend_notification_read', { notification_id: notificationId });
  if (error) throw error;
}
