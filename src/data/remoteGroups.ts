import type { SupabaseClient } from '@supabase/supabase-js';
import type { Group, Trip, TripPhoto } from '../domain/models';
import { supabase } from './supabase';

/** One remote account can be linked to a member only through an accepted-friend invitation. */
export type RemoteFriendInvite = { memberId: string; friendUserId: string };

export type RemoteGroupInvitation = {
  invitationId: string;
  groupId: string;
  groupName: string;
  memberId: string;
  memberName: string;
  friendUserId: string;
  status: 'pending';
  invitedAt: string;
};

export type RemoteGroup = {
  group: Group;
  /** public.groups.id UUID string, required by database RPCs that mutate one group trip. */
  groupDbId: string;
  memberAccounts: Record<string, string>;
  memberStatuses: Record<string, 'pending' | 'active' | 'removed'>;
};

export type AcceptedRemoteGroupInvitation = {
  invitationId: string;
  groupId: string;
  memberId: string;
  friendUserId: string;
  status: 'accepted';
  membership: { groupId: string; userId: string; status: 'active' };
  notification: { id: string; type: 'invitation_accepted'; groupId: string };
};

type RemoteGroupNotificationBase = {
  id: string;
  groupId: string;
  groupName: string;
  memberId: string;
  memberName: string;
  invitationId?: string;
  createdAt: string;
  readAt: string | null;
};

export type RemoteGroupNotification = RemoteGroupNotificationBase & (
  | { type: 'member_left' | 'group_invitation' | 'invitation_accepted' }
  | {
      type: 'trip_start_prompt';
      /** App-facing client ID of the group. */
      groupId: string;
      /** public.groups.id UUID string; pass this as requested_group_id to start_group_trip. */
      groupDbId: string;
      /** App trip ID from groups.client_snapshot, not public.trips.id. */
      tripId: string;
      tripName: string;
    }
  | {
      type: 'trip_started';
      /** App trip ID from groups.client_snapshot, not public.trips.id. */
      tripId: string;
      tripName: string;
      startedAt: string;
    }
  | {
      type: 'trip_created';
      /** App-facing client ID of the group. */
      groupId: string;
      /** public.groups.id UUID string. */
      groupDbId: string;
      /** App trip ID from groups.client_snapshot, not public.trips.id. */
      tripId: string;
      tripName: string;
    }
);

export class RemoteGroupApiError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'RemoteGroupApiError';
  }
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) throw new Error('원격 모임 응답이 비어 있습니다.');
  return result.data;
}

// Local file URIs are device-specific and are not uploaded by this API. Keep photo metadata
// while ensuring private device paths never enter the shared JSON snapshot.
function snapshotWithoutLocalPhotoUris(group: Group): Group {
  return {
    ...group,
    trips: group.trips.map((trip) => ({
      ...trip,
      photos: trip.photos?.map((photo: TripPhoto) => ({ ...photo, uri: '' })),
    })),
  };
}

/**
 * Creates or updates a group snapshot. The authenticated account is always the owner/member.
 * friendInvites maps existing Group member IDs to accepted-friend Supabase user IDs; all other
 * members remain name-only guests. Pending invitees do not gain group read access until accepted.
 */
export async function saveRemoteGroup(
  client: SupabaseClient,
  group: Group,
  friendInvites: RemoteFriendInvite[] = [],
): Promise<void> {
  const members = group.members.map((member) => ({
    member_id: member.id,
    display_name: member.name,
    friend_user_id: friendInvites.find((invite) => invite.memberId === member.id)?.friendUserId ?? null,
  }));
  unwrap(await client.rpc('save_group_snapshot', {
    requested_group_id: group.id,
    requested_name: group.name,
    requested_members: members,
    requested_snapshot: { version: 1, group: snapshotWithoutLocalPhotoUris(group) },
  }));
}

/** Loads groups for which the current account is the owner or an accepted active member. */
export async function loadRemoteGroups(client: SupabaseClient): Promise<RemoteGroup[]> {
  return unwrap(await client.rpc('list_my_group_snapshots')) as RemoteGroup[];
}

/**
 * Refreshes the caller's server-authorized group snapshots after group row changes.
 * RLS on public.groups limits Realtime row events to groups the account can read;
 * the callback receives data only from list_my_group_snapshots, never raw row payloads.
 * The caller must invoke the returned cleanup when its observer is no longer needed.
 */
export function subscribeRemoteGroups(
  client: SupabaseClient,
  onGroups: (groups: RemoteGroup[]) => void,
  onError?: (error: Error) => void,
): () => void {
  let closed = false;
  let refreshQueued = false;
  const channel = client
    .channel(`remote-groups-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, () => {
      if (closed || refreshQueued) return;
      refreshQueued = true;
      void loadRemoteGroups(client)
        .then((groups) => {
          if (!closed) onGroups(groups);
        })
        .catch((error: unknown) => {
          if (!closed) onError?.(error instanceof Error ? error : new Error(String(error)));
        })
        .finally(() => {
          refreshQueued = false;
        });
    })
    .subscribe((status, error) => {
      if (closed) return;
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        onError?.(error instanceof Error ? error : new Error(`Group realtime subscription ${status.toLowerCase()}.`));
      }
    });

  return () => {
    if (closed) return;
    closed = true;
    void client.removeChannel(channel);
  };
}

/** Returns pending invitations addressed to this account; group/member details remain recipient-scoped. */
export async function loadMyGroupInvitations(client: SupabaseClient): Promise<RemoteGroupInvitation[]> {
  return unwrap(await client.rpc('list_my_group_invitations')) as RemoteGroupInvitation[];
}

/** Accepts this account's invitation; membership activation and creator notification are atomic. */
export async function acceptRemoteGroupInvitation(
  client: SupabaseClient,
  invitationId: string,
): Promise<AcceptedRemoteGroupInvitation> {
  return unwrap(await client.rpc('accept_group_member_invitation', {
    requested_invitation_id: invitationId,
  })) as AcceptedRemoteGroupInvitation;
}

/** Permanently deletes a group and its server-side trips and dependent records. Owner check is server-side. */
export async function deleteRemoteGroup(client: SupabaseClient, groupId: string): Promise<void> {
  const { error } = await client.rpc('delete_remote_group', { requested_group_id: groupId });
  if (error) throw new RemoteGroupApiError(
    error.message.includes('group_not_found_or_not_owner') ? 'group_not_found_or_not_owner' : 'delete_failed',
    error.message,
  );
}

/**
 * Deletes exactly one app trip from the shared snapshot through the owner-authorized RPC.
 * Pass public.groups.id as groupDbId and the app snapshot trip ID separately. On success,
 * callers must reload with loadRemoteGroups() and use that authoritative snapshot as state.
 */
export async function deleteRemoteGroupTrip(
  client: SupabaseClient,
  groupDbId: string,
  tripId: string,
): Promise<void> {
  const { data, error } = await client.rpc('delete_group_trip', {
    requested_group_id: groupDbId,
    requested_trip_id: tripId,
  });
  if (error) {
    const errorCodes: Record<string, string> = {
      '42501:GROUP_TRIP_NOT_FOUND_OR_FORBIDDEN': 'group_trip_not_found_or_forbidden',
      'P1001:GROUP_TRIP_HAS_EXPENSES': 'group_trip_has_expenses',
      'P1002:GROUP_TRIP_ALREADY_SETTLED': 'group_trip_already_settled',
      'P1003:GROUP_TRIP_EXPENSES_UNVERIFIABLE': 'group_trip_expenses_unverifiable',
    };
    const code = errorCodes[`${error.code}:${error.message}`];
    throw new RemoteGroupApiError(code ?? 'delete_group_trip_failed', error.message);
  }
  if (data !== true) {
    throw new RemoteGroupApiError('delete_group_trip_failed', 'The server did not confirm trip deletion.');
  }
}

/** Leaves an active account membership and atomically stores a member_left notification for the creator. */
export async function leaveRemoteGroup(client: SupabaseClient, groupId: string): Promise<void> {
  const { error } = await client.rpc('leave_remote_group', { requested_group_id: groupId });
  if (error) throw new RemoteGroupApiError(
    error.message.includes('active_group_member_not_found') ? 'active_group_member_not_found' : 'leave_failed',
    error.message,
  );
}

/** Loads in-app events addressed to this account, including pending invites and creator events. */
export async function loadGroupNotifications(client: SupabaseClient): Promise<RemoteGroupNotification[]> {
  return unwrap(await client.rpc('list_my_group_notifications')) as RemoteGroupNotification[];
}

/**
 * Watches only notifications addressed to the signed-in account. On connect and each INSERT,
 * reloads the canonical recipient-only list through list_my_group_notifications. The caller must
 * pass the current auth user ID and invoke the returned cleanup on logout/account change.
 */
export function subscribeGroupNotifications(
  client: SupabaseClient,
  userId: string,
  onNotifications: (notifications: RemoteGroupNotification[]) => void,
  onError?: (error: Error) => void,
): () => void {
  let closed = false;
  let refreshQueued = false;
  const refresh = () => {
    if (closed || refreshQueued) return;
    refreshQueued = true;
    void loadGroupNotifications(client)
      .then((notifications) => {
        if (!closed) onNotifications(notifications);
      })
      .catch((error: unknown) => {
        if (!closed) onError?.(error instanceof Error ? error : new Error(String(error)));
      })
      .finally(() => {
        refreshQueued = false;
      });
  };
  const channel = client
    .channel(`group-notifications-${userId}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'group_notifications',
      filter: `recipient_user_id=eq.${userId}`,
    }, refresh)
    .subscribe((status, error) => {
      if (closed) return;
      if (status === 'SUBSCRIBED') refresh();
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        onError?.(error instanceof Error ? error : new Error(`Group notification subscription ${status.toLowerCase()}.`));
      }
    });

  return () => {
    if (closed) return;
    closed = true;
    void client.removeChannel(channel);
  };
}

export type CreatedRemoteGroupTrip = {
  /** App-facing client ID of the group. */
  groupId: string;
  /** public.groups.id UUID string. */
  groupDbId: string;
  /** App trip ID from groups.client_snapshot. */
  tripId: string;
  tripName: string;
  /** False means this exact request was already created by this account. */
  created: boolean;
};

/**
 * Adds one app trip through the active-member RPC, never the owner-only snapshot save RPC.
 * Only supported creation fields are sent; expenses are always empty and photo/lifecycle fields
 * are omitted. After any successful response, including created=false, callers must reload with
 * loadRemoteGroups() and use that authoritative snapshot as screen state. If that reload fails,
 * retry the reload rather than blindly retrying creation.
 */
export async function createRemoteGroupTrip(
  client: SupabaseClient,
  groupDbId: string,
  trip: Trip,
): Promise<CreatedRemoteGroupTrip> {
  const requestedTrip = {
    id: trip.id,
    name: trip.name,
    destination: trip.destination,
    detailAddress: trip.detailAddress,
    dateRange: trip.dateRange,
    treasurerId: trip.treasurerId,
    expenses: [],
  };
  const { data, error } = await client.rpc('create_group_trip', {
    requested_group_id: groupDbId,
    requested_trip: requestedTrip,
  });
  if (error) {
    const code = [
      'authentication_required',
      'group_trip_not_found_or_not_member',
      'invalid_group_trip',
      'invalid_group_trip_date_range',
      'group_trip_id_conflict',
    ].find((candidate) => error.message.includes(candidate));
    throw new RemoteGroupApiError(code ?? 'create_group_trip_failed', error.message);
  }
  if (data === null) throw new RemoteGroupApiError('create_group_trip_failed', 'The server returned no trip creation result.');
  return data as CreatedRemoteGroupTrip;
}

export type StartedRemoteGroupTrip = {
  /** App-facing client ID of the group. */
  groupId: string;
  /** public.groups.id UUID string. */
  groupDbId: string;
  /** App trip ID from groups.client_snapshot. */
  tripId: string;
  /** Server-assigned UTC timestamp in ISO format. */
  startedAt: string;
};

/**
 * Starts a due trip through the authenticated, server-authorized RPC. The server checks active
 * membership and trip eligibility and records startedAt; this client never edits a snapshot.
 * After success, call loadRemoteGroups() to refresh the authoritative group snapshot.
 */
export async function startRemoteGroupTrip(
  client: SupabaseClient,
  groupDbId: string,
  tripId: string,
): Promise<StartedRemoteGroupTrip> {
  const { data, error } = await client.rpc('start_group_trip', {
    requested_group_id: groupDbId,
    requested_trip_id: tripId,
  });
  if (error) {
    const code = [
      'authentication_required',
      'group_trip_not_found_or_not_member',
      'trip_not_startable',
    ].find((candidate) => error.message.includes(candidate));
    throw new RemoteGroupApiError(code ?? 'start_group_trip_failed', error.message);
  }
  if (data === null) throw new RemoteGroupApiError('start_group_trip_failed', 'The server returned no trip start result.');
  return data as StartedRemoteGroupTrip;
}

/** Marks one of the signed-in account's group notifications read; repeat calls are safe. */
export async function markGroupNotificationRead(notificationId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.rpc('mark_my_group_notification_read', {
    notification_id: notificationId,
  });
  if (error) throw error;
}
