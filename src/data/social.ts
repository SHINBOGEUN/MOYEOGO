import type { SupabaseClient } from '@supabase/supabase-js';

export type SocialProfile = {
  user_id: string;
  nickname: string | null;
  friend_code: string;
  notifications_enabled: boolean;
};

export type FriendEntry = { user_id: string; nickname: string; friend_code: string; relation_status?: 'pending' | 'accepted' | null };
export type FriendRequestEntry = {
  id: string;
  direction: 'incoming' | 'outgoing';
  status: 'pending';
  user_id: string;
  nickname: string;
  friend_code: string;
  created_at: string;
};
export type SocialData = { profile: SocialProfile; friends: FriendEntry[]; requests: FriendRequestEntry[] };

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

export async function loadSocialData(client: SupabaseClient): Promise<SocialData> {
  return unwrap(await client.rpc('get_my_social_data')) as SocialData;
}

export async function saveProfile(client: SupabaseClient, nickname: string, notificationsEnabled: boolean) {
  return unwrap(await client.rpc('save_my_profile', {
    requested_nickname: nickname,
    requested_notifications_enabled: notificationsEnabled,
  })) as SocialProfile;
}

export async function isNicknameAvailable(client: SupabaseClient, nickname: string): Promise<boolean> {
  return unwrap(await client.rpc('check_nickname_available', { requested_nickname: nickname })) as boolean;
}

export async function searchFriend(client: SupabaseClient, friendCode: string): Promise<FriendEntry | null> {
  return unwrap(await client.rpc('lookup_friend_by_code', { requested_friend_code: friendCode })) as FriendEntry | null;
}

export async function sendFriendRequest(client: SupabaseClient, friendCode: string) {
  unwrap(await client.rpc('send_friend_request', { requested_friend_code: friendCode }));
}

export async function respondFriendRequest(client: SupabaseClient, requestId: string, accept: boolean) {
  unwrap(await client.rpc('respond_to_friend_request', { request_id: requestId, accept_request: accept }));
}

export async function cancelFriendRequest(client: SupabaseClient, requestId: string) {
  unwrap(await client.rpc('cancel_friend_request', { request_id: requestId }));
}

export async function removeFriend(client: SupabaseClient, friendUserId: string) {
  unwrap(await client.rpc('remove_friend', { friend_user_id: friendUserId }));
}
