import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import MapView, { Marker } from 'react-native-maps';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  Share,
  ScrollView,
  StyleSheet,
  StatusBar as NativeStatusBar,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  calculateBalances,
  calculateMinimumTransfers,
  type Expense,
  type Member,
} from './src/domain/settlement';
import type { Group, Trip, TripPhoto } from './src/domain/models';
import { createAccountGroupStore } from './src/data/groupStore';
import { DateRangePicker, formatDateRange } from './src/components/DateRangePicker';
import { KeyboardActionAccessory } from './src/components/KeyboardActionAccessory';
import { RegionPicker } from './src/components/RegionPicker';
import { TripPhotos } from './src/components/TripPhotos';
import { TripFallbackCover } from './src/components/TripFallbackCover';
import { getTripCoverPhoto, getTripFallbackCoverOption } from './src/domain/tripCoverPhoto';
import { parseTripDateRange, withUpdatedTripDetails } from './src/domain/tripEditing';
import { removeTripExpense, replaceTripExpense } from './src/domain/expenseEditing';
import { createExpense } from './src/domain/expenseCreation';
import { getExpenseCreatorName } from './src/domain/expenseAttribution';
import { colors } from './src/theme/colors';
import { getTripPhase } from './src/domain/tripLifecycle';
import { formatTripDday, getMillisecondsUntilNextSeoulDay, getTripDday } from './src/domain/tripDday';
import { getSignupPasswordError, getSignupPasswordRequirements } from './src/domain/passwordPolicy';
import { hasVerifiedEmailForApp, isDuplicateSignupResponse } from './src/domain/authSignup';
import { buildGroupMemberNames, buildRemoteFriendInvites, mergeSelectedFriendNames } from './src/domain/groupCreation';
import { applyGroupEdits, getMemberRemovalError } from './src/domain/groupEditing';
import * as WebBrowser from 'expo-web-browser';
import * as ExpoLinking from 'expo-linking';
import { isSupabaseConfigured, supabase } from './src/data/supabase';
import type { User } from '@supabase/supabase-js';
import { getNicknameError, normalizeFriendCode, normalizeNickname } from './src/domain/nickname';
import { cancelFriendRequest, isNicknameAvailable, loadSocialData, removeFriend, respondFriendRequest, saveProfile, searchFriend, sendFriendRequest, type FriendEntry, type SocialData, type SocialProfile } from './src/data/social';
import { loadFriendNotifications, markFriendNotificationRead, type FriendNotification } from './src/data/friendNotifications';
import { clearStalePushToken, registerPushToken, unregisterPushToken } from './src/data/pushNotifications';
import { acceptRemoteGroupInvitation, createRemoteGroupTrip, deleteRemoteGroup, deleteRemoteGroupTrip, leaveRemoteGroup, loadGroupNotifications, loadMyGroupInvitations, loadRemoteGroups, markGroupNotificationRead, saveRemoteGroup, startRemoteGroupTrip, subscribeGroupNotifications, subscribeRemoteGroups, RemoteGroupApiError, type RemoteGroup, type RemoteGroupInvitation, type RemoteGroupNotification } from './src/data/remoteGroups';
import { isMemberActiveForDisplay, isRemoteMemberActive, mergeRemoteGroupSnapshot, RemoteGroupRefreshGeneration } from './src/domain/remoteGroupRefresh';
import { preserveLocalGroupPhotoUris } from './src/data/localGroupPhotos';
import { getGroupActivityRpcDiagnostic, listGroupActivity, type GroupActivityEvent } from './src/data/remoteGroupActivity';
import { appendGroupActivityPage } from './src/domain/groupActivityPagination';
import {
  completeRemoteSettlement, createRemoteExpense, deleteRemoteExpense, deleteRemoteTripPhoto,
  downloadRemoteTripPhoto, loadRemoteTripSync, reopenRemoteSettlement, setRemoteTripCover,
  subscribeRemoteTripSync, uploadRemoteTripPhoto, updateRemoteExpense,
  type RemotePhotoInput, type RemoteTripSyncSnapshot,
} from './src/data/remoteTripSync';
import { mergeRemoteTripSyncSnapshot, preserveTripSyncEntities } from './src/domain/tripSyncMapping';
import { tripSyncFailureMessage } from './src/domain/tripSyncMessage';
import {
  reconcileExpenseFromRemoteSnapshot, reconcileSettlementFromRemoteSnapshot,
  rollbackExpenseOperation, rollbackSettlementOperation,
  tripSyncCommandStatusFromError,
} from './src/domain/tripSyncRecovery';
import { TripSyncStatusGeneration } from './src/domain/tripSyncStatusGeneration';
import * as Notifications from 'expo-notifications';
import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import Storage from 'expo-sqlite/kv-store';

WebBrowser.maybeCompleteAuthSession();

type Screen =
  | 'home'
  | 'groups'
  | 'trips'
  | 'map'
  | 'settlements'
  | 'group'
  | 'trip'
  | 'edit-trip'
  | 'edit-expense'
  | 'settlement'
  | 'account'
  | 'friends'
  | 'notifications'
  | 'nickname-setup'
  | 'create-group'
  | 'edit-group'
  | 'create-trip'
  | 'add-expense';

type PrimaryTab = 'groups' | 'trips' | 'home' | 'map' | 'friends';

const groupActivityLabels: Record<GroupActivityEvent['type'], string> = {
  photo_added: '사진을 추가했어요',
  photo_cover_changed: '대표 사진을 변경했어요',
  photo_removed: '사진을 삭제했어요',
  expense_added: '지출을 기록했어요',
  expense_updated: '지출을 수정했어요',
  expense_removed: '지출을 삭제했어요',
  settlement_completed: '정산을 완료했어요',
  settlement_reopened: '정산을 다시 열었어요',
};

type GroupActivityUiState = {
  key: string;
  status: 'loading' | 'ready' | 'error';
  events: GroupActivityEvent[];
  nextCursor: string | null;
  loadingMore: boolean;
  moreError: boolean;
};

const primaryTabs: { id: PrimaryTab; label: string }[] = [
  { id: 'groups', label: '모임' },
  { id: 'trips', label: '여행' },
  { id: 'home', label: '홈' },
  { id: 'map', label: '지도' },
  { id: 'friends', label: '친구' },
];

const navigationIconSources: Record<PrimaryTab, number> = {
  groups: require('./assets/navigation/route-groups.png'),
  trips: require('./assets/navigation/route-trips.png'),
  home: require('./assets/navigation/route-home.png'),
  map: require('./assets/navigation/route-map.png'),
  friends: require('./assets/navigation/route-friends.png'),
};

function getTripStartTime(dateRange: string) {
  const match = dateRange.match(/^(\d{4})\.\s*(\d{2})\.\s*(\d{2})\./);
  if (!match) return 0;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function getTripDateParts(dateRange: string) {
  const dates = [...dateRange.matchAll(/(\d{4})\.\s*(\d{2})\.\s*(\d{2})\./g)];
  if (dates.length < 2) return null;
  return dates.slice(0, 2).map((match) => ({
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    timestamp: Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  }));
}

function formatJournalDate(dateRange: string) {
  const dates = getTripDateParts(dateRange);
  if (!dates) return dateRange;
  const [start, end] = dates;
  return `${start.year}. ${String(start.month).padStart(2, '0')}. ${String(start.day).padStart(2, '0')} — ${String(end.month).padStart(2, '0')}. ${String(end.day).padStart(2, '0')}`;
}

function getJournalTripStatus(trip: Trip) {
  if (trip.settledAt) return '정산완료';
  if (trip.endedAt) return '여행 종료';
  if (trip.startedAt) return '진행중';
  const dates = getTripDateParts(trip.dateRange);
  if (!dates) return '정산대기';
  const today = new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const [start, end] = dates;
  if (todayUtc < start.timestamp) return '여행 예정';
  if (todayUtc <= end.timestamp) return '진행중';
  return '정산대기';
}

function getTripRecords(groups: Group[]) {
  return groups
    .flatMap((group) => group.trips.map((trip) => ({ group, trip })))
    .sort((left, right) => getTripStartTime(right.trip.dateRange) - getTripStartTime(left.trip.dateRange));
}

const money = (amount: number) => `${new Intl.NumberFormat('ko-KR').format(amount)}원`;
const makeId = () => Math.random().toString(36).slice(2, 10);
const commonExpenseTitles = ['점심 식사', '저녁 식사', '숙소비', '교통비', '카페·간식'];
const profilePhotoStorageKey = (userId: string) => `moyeogo:profile-photo:user:${encodeURIComponent(userId)}:v1`;
const friendIntroStorageKey = (userId: string) => `moyeogo:friend-intro:user:${encodeURIComponent(userId)}:v1`;
const getAccountNickname = (user: User | null) => {
  if (!user) return '';
  const metadata = user.user_metadata ?? {};
  const nickname = [metadata.nickname, metadata.display_name, metadata.full_name, metadata.name, metadata.given_name]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
  return nickname?.trim() || user.email?.split('@')[0] || '나';
};

export default function App() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [deletedGroupIds, setDeletedGroupIds] = useState<string[]>([]);
  const [storageState, setStorageState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [storageError, setStorageError] = useState<string | null>(null);
  const [storageLoadAttempt, setStorageLoadAttempt] = useState(0);
  const [storageUserId, setStorageUserId] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>('home');
  const [activeTab, setActiveTab] = useState<PrimaryTab>('home');
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);

  const [groupName, setGroupName] = useState('');
  const [memberNames, setMemberNames] = useState<string[]>([]);
  const [memberNameDraft, setMemberNameDraft] = useState('');
  const [selectedGroupFriendIds, setSelectedGroupFriendIds] = useState<string[]>([]);
  const [groupMemberAccounts, setGroupMemberAccounts] = useState<Record<string, string>>({});
  const [remoteMemberStatuses, setRemoteMemberStatuses] = useState<Record<string, Record<string, 'pending' | 'active' | 'removed'>>>({});
  const [remoteGroupSnapshotState, setRemoteGroupSnapshotState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [remoteGroupDbIds, setRemoteGroupDbIds] = useState<Record<string, string>>({});
  const [groupActivityUi, setGroupActivityUi] = useState<GroupActivityUiState | null>(null);
  const [groupActivityReload, setGroupActivityReload] = useState(0);
  const groupActivityMoreBusy = useRef(false);
  const groupActivityGeneration = useRef(0);
  const [remoteMemberAccounts, setRemoteMemberAccounts] = useState<Record<string, Record<string, string>>>({});
  const [groupInvitations, setGroupInvitations] = useState<RemoteGroupInvitation[]>([]);
  const [groupInvitationState, setGroupInvitationState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [acceptingInvitationId, setAcceptingInvitationId] = useState<string | null>(null);
  const [groupCreating, setGroupCreating] = useState(false);
  const groupCreateOperation = useRef(false);
  const [editGroupName, setEditGroupName] = useState('');
  const [editMembers, setEditMembers] = useState<Member[]>([]);
  const [editMemberDraft, setEditMemberDraft] = useState('');
  const [selectedEditFriendIds, setSelectedEditFriendIds] = useState<string[]>([]);
  const [tripName, setTripName] = useState('');
  const [destination, setDestination] = useState('');
  const [detailAddress, setDetailAddress] = useState('');
  const [tripStartDate, setTripStartDate] = useState<Date | null>(null);
  const [tripEndDate, setTripEndDate] = useState<Date | null>(null);
  const [treasurerId, setTreasurerId] = useState('');
  const [expenseTitle, setExpenseTitle] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseAmountFocused, setExpenseAmountFocused] = useState(false);
  const [payerId, setPayerId] = useState('');
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authStatus, setAuthStatus] = useState<'checking' | 'unconfigured' | 'signed-out' | 'signed-in'>('checking');
  const [authMode, setAuthMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authEmailLocal, setAuthEmailLocal] = useState('');
  const [authEmailDomain, setAuthEmailDomain] = useState('gmail.com');
  const [authEmailCustomDomain, setAuthEmailCustomDomain] = useState('');
  const [showEmailDomainOptions, setShowEmailDomainOptions] = useState(false);
  const [authPassword, setAuthPassword] = useState('');
  const [authPasswordConfirmation, setAuthPasswordConfirmation] = useState('');
  const [authPasswordVisible, setAuthPasswordVisible] = useState(false);
  const [authPasswordConfirmationVisible, setAuthPasswordConfirmationVisible] = useState(false);
  const [authVerificationEmail, setAuthVerificationEmail] = useState('');
  const [authVerificationPending, setAuthVerificationPending] = useState(false);
  const [authOtp, setAuthOtp] = useState('');
  const [authOtpExpiresAt, setAuthOtpExpiresAt] = useState<number | null>(null);
  const [authResendAvailableAt, setAuthResendAvailableAt] = useState<number | null>(null);
  const [authOtpSecondsRemaining, setAuthOtpSecondsRemaining] = useState(0);
  const [authResendSecondsRemaining, setAuthResendSecondsRemaining] = useState(0);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState('');
  const [socialState, setSocialState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [socialError, setSocialError] = useState('');
  const [socialProfile, setSocialProfile] = useState<SocialProfile | null>(null);
  const [socialData, setSocialData] = useState<SocialData | null>(null);
  const [profilePhotoUri, setProfilePhotoUri] = useState<string | null>(null);
  const [profilePhotoBusy, setProfilePhotoBusy] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState('');
  const [nicknameMessage, setNicknameMessage] = useState('');
  const [nicknameCheckState, setNicknameCheckState] = useState<'idle' | 'checking' | 'available' | 'taken' | 'error'>('idle');
  const [nicknameCheckedValue, setNicknameCheckedValue] = useState('');
  const nicknameCheckSequence = useRef(0);
  const [friendCodeDraft, setFriendCodeDraft] = useState('');
  const [friendSearchResult, setFriendSearchResult] = useState<FriendEntry | null>(null);
  const [friendMessage, setFriendMessage] = useState('');
  const [friendBusy, setFriendBusy] = useState(false);
  const [friendIntroVisible, setFriendIntroVisible] = useState(false);
  const [friendSection, setFriendSection] = useState<'friends' | 'received' | 'sent'>('friends');
  const [friendSearchVisible, setFriendSearchVisible] = useState(false);
  const [friendNotifications, setFriendNotifications] = useState<FriendNotification[]>([]);
  const [notificationState, setNotificationState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [notificationMessage, setNotificationMessage] = useState('');
  const [groupNotifications, setGroupNotifications] = useState<RemoteGroupNotification[]>([]);
  const [groupNotificationState, setGroupNotificationState] = useState<'loading' | 'ready' | 'error'>('loading');
  const readNotificationIdsByUser = useRef(new Map<string, Set<string>>());
  const optimisticGroupReadAtByUser = useRef(new Map<string, Map<string, string>>());
  const groupReadRequests = useRef(new Map<string, Promise<void>>());
  const groupReadRequestSequence = useRef(0);
  const [groupActionBusy, setGroupActionBusy] = useState(false);
  const [tripDeleteBusy, setTripDeleteBusy] = useState(false);
  const [tripSaving, setTripSaving] = useState(false);
  const [tripStartBusy, setTripStartBusy] = useState(false);
  const [tripSyncMessage, setTripSyncMessageState] = useState('');
  const [tripSyncMessageTripKey, setTripSyncMessageTripKey] = useState<string | null>(null);
  const [tripSyncLoading, setTripSyncLoading] = useState(false);
  const [tripSyncLoadingTripKey, setTripSyncLoadingTripKey] = useState<string | null>(null);
  const [tripSyncOutcome, setTripSyncOutcome] = useState<'local' | 'local-save-failed' | 'applied' | 'rejected' | 'unknown' | null>(null);
  const [tripSyncOutcomeTripKey, setTripSyncOutcomeTripKey] = useState<string | null>(null);
  const [tripSyncOutcomeCommandId, setTripSyncOutcomeCommandId] = useState<string | null>(null);
  const tripSyncRevisions = useRef(new Map<string, number>());
  const tripSyncVersions = useRef(new Map<string, { coverVersion: number; settlementVersion: number }>());
  const tripSyncOperations = useRef(new Map<string, number>());
  const tripSyncOperationSequence = useRef(0);
  const tripSyncStatusGenerations = useRef(new TripSyncStatusGeneration());
  const [tripDateNow, setTripDateNow] = useState(() => new Date());
  const [notificationReturnScreen, setNotificationReturnScreen] = useState<Screen>('home');
  const [pushMessage, setPushMessage] = useState('');
  const [pushRefreshIndex, setPushRefreshIndex] = useState(0);
  const pushOperation = useRef<Promise<void>>(Promise.resolve());
  const signingOut = useRef(false);
  const activeNotificationUser = useRef<string | null>(null);
  activeNotificationUser.current = authStatus === 'signed-in' ? authUser?.id ?? null : null;
  const remoteGroupRefreshGeneration = useRef(new RemoteGroupRefreshGeneration());
  remoteGroupRefreshGeneration.current.setActiveUser(activeNotificationUser.current);
  const [settlementReturnScreen, setSettlementReturnScreen] = useState<'trip' | 'settlements'>('trip');
  const [accountReturnScreen, setAccountReturnScreen] = useState<Screen>('home');
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [profileBusy, setProfileBusy] = useState(false);
  const processedAuthCodes = useRef(new Set<string>());
  const contentScroll = useRef<ScrollView>(null);
  const authNameInput = useRef<TextInput>(null);
  const authEmailInput = useRef<TextInput>(null);
  const authEmailDomainInput = useRef<TextInput>(null);
  const authPasswordInput = useRef<TextInput>(null);
  const authPasswordConfirmationInput = useRef<TextInput>(null);
  const authOtpInput = useRef<TextInput>(null);
  const groupNameInput = useRef<TextInput>(null);
  const memberNameInput = useRef<TextInput>(null);
  const editGroupNameInput = useRef<TextInput>(null);
  const editMemberNameInput = useRef<TextInput>(null);
  const editMemberInputs = useRef<Record<string, TextInput | null>>({});
  const expenseAmountInput = useRef<TextInput>(null);
  const friendCodeInput = useRef<TextInput>(null);

  useEffect(() => {
    const client = supabase;
    if (!client) {
      setAuthStatus('unconfigured');
      return;
    }
    let active = true;
    void client.auth.getSession().then(({ data }) => {
      if (!active) return;
      const sessionUser = data.session?.user ?? null;
      const emailVerified = hasVerifiedEmailForApp(sessionUser);
      setAuthUser(emailVerified ? sessionUser : null);
      setAuthStatus(data.session && emailVerified ? 'signed-in' : 'signed-out');
    }).catch(() => {
      if (active) setAuthStatus('signed-out');
    });
    const { data: authListener } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      const sessionUser = session?.user ?? null;
      const emailVerified = hasVerifiedEmailForApp(sessionUser);
      setAuthUser(emailVerified ? sessionUser : null);
      setAuthStatus(session && emailVerified ? 'signed-in' : 'signed-out');
    });

    const exchangeAuthUrl = async (url: string | null) => {
      if (!url) return;
      try {
        const code = new URL(url).searchParams.get('code');
        if (code && !processedAuthCodes.current.has(code)) {
          processedAuthCodes.current.add(code);
          const { error } = await client.auth.exchangeCodeForSession(code);
          if (error) throw error;
          setAuthMessage('로그인되었습니다.');
        }
      } catch (error) {
        setAuthMessage(error instanceof Error ? error.message : '인증 링크를 확인하지 못했어요.');
      }
    };
    void Linking.getInitialURL().then(exchangeAuthUrl);
    const linkListener = Linking.addEventListener('url', ({ url }) => { void exchangeAuthUrl(url); });
    return () => {
      active = false;
      authListener.subscription.unsubscribe();
      linkListener.remove();
    };
  }, []);

  const refreshSocialData = async () => {
    if (!supabase || !authUser) return;
    const requestedUserId = authUser.id;
    const data = await loadSocialData(supabase);
    if (activeNotificationUser.current !== requestedUserId) return;
    setSocialData(data);
    setSocialProfile(data.profile);
    setNicknameDraft(data.profile.nickname ?? getAccountNickname(authUser));
    setNotificationsEnabled(data.profile.notifications_enabled);
  };

  const refreshRemoteGroupData = async (requestedUserId: string) => {
    if (!supabase) return { groupsLoaded: false, invitationsLoaded: false, remoteGroups: null as RemoteGroup[] | null };
    const generation = remoteGroupRefreshGeneration.current.begin(requestedUserId);
    if (!generation) return { groupsLoaded: false, invitationsLoaded: false, remoteGroups: null as RemoteGroup[] | null };
    const client = supabase;
    setRemoteGroupSnapshotState('loading');
    setGroupInvitationState('loading');
    const [remoteResult, invitationResult] = await Promise.allSettled([
      loadRemoteGroups(client),
      loadMyGroupInvitations(client),
    ]);
    if (activeNotificationUser.current !== requestedUserId || !remoteGroupRefreshGeneration.current.isCurrent(requestedUserId, generation)) {
      return { groupsLoaded: false, invitationsLoaded: false, remoteGroups: null as RemoteGroup[] | null };
    }
    if (remoteResult.status === 'fulfilled') {
      setRemoteGroupSnapshotState('ready');
      setRemoteMemberStatuses(Object.fromEntries(remoteResult.value.map((item) => [item.group.id, item.memberStatuses])));
      setRemoteMemberAccounts(Object.fromEntries(remoteResult.value.map((item) => [item.group.id, item.memberAccounts])));
      setRemoteGroupDbIds(Object.fromEntries(remoteResult.value.map((item) => [item.group.id, item.groupDbId ?? ''])));
      const latestRemoteGroups = [...new Map(remoteResult.value.map((item) => [item.group.id, item.group])).values()];
      setGroups((current) => {
        const deletedIds = new Set(deletedGroupIds);
        const withLocalPhotoUris = preserveLocalGroupPhotoUris(latestRemoteGroups, current);
        const withSyncedTripEntities = preserveTripSyncEntities(withLocalPhotoUris, current);
        return mergeRemoteGroupSnapshot(
          withSyncedTripEntities.filter((item) => !deletedIds.has(item.id)),
          current,
          new Set(Object.keys(remoteGroupDbIds)),
        ).filter((item) => !deletedIds.has(item.id));
      });
    } else {
      setRemoteGroupSnapshotState('error');
    }
    if (invitationResult.status === 'fulfilled') {
      setGroupInvitations(invitationResult.value);
      setGroupInvitationState('ready');
    } else {
      setGroupInvitationState('error');
    }
    return {
      groupsLoaded: remoteResult.status === 'fulfilled',
      invitationsLoaded: invitationResult.status === 'fulfilled',
      remoteGroups: remoteResult.status === 'fulfilled' ? remoteResult.value : null,
    };
  };

  const refreshFriendNotifications = async () => {
    if (!supabase || !authUser?.id) return;
    const requestedUserId = authUser.id;
    try {
      const rows = await loadFriendNotifications(supabase);
      if (activeNotificationUser.current !== requestedUserId) return;
      const locallyRead = readNotificationIdsByUser.current.get(requestedUserId);
      setFriendNotifications(rows.map((row) => locallyRead?.has(`friend:${row.id}`) && !row.read_at ? { ...row, read_at: new Date().toISOString() } : row));
      setNotificationState('ready');
      setNotificationMessage('');
    } catch {
      if (activeNotificationUser.current !== requestedUserId) return;
      setNotificationState('error');
      setNotificationMessage('알림을 불러오지 못했어요. 다시 시도해 주세요.');
    }
  };

  const refreshGroupNotifications = async () => {
    if (!supabase || !authUser?.id) return;
    const requestedUserId = authUser.id;
    setGroupNotificationState('loading');
    try {
      const rows = await loadGroupNotifications(supabase);
      if (activeNotificationUser.current !== requestedUserId) return;
      const locallyRead = readNotificationIdsByUser.current.get(requestedUserId);
      const optimisticReadAt = optimisticGroupReadAtByUser.current.get(requestedUserId);
      setGroupNotifications(rows.map((row) => locallyRead?.has(`group:${row.id}`) && !row.readAt
        ? { ...row, readAt: optimisticReadAt?.get(row.id) ?? new Date().toISOString() }
        : row));
      setGroupNotificationState('ready');
    } catch {
      if (activeNotificationUser.current !== requestedUserId) return;
      setGroupNotificationState('error');
    }
  };

  const confirmStartTrip = (groupDbId: string, groupId: string, tripId: string) => {
    if (!authUser || !supabase || !isActiveRemoteMember(groupId, authUser.id) || tripStartBusy) return;
    Alert.alert('여행을 시작할까요?', '여행이 시작되면 시작 상태가 모임에 반영돼요. 정말 시작할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '여행 시작', onPress: () => { void (async () => {
        if (!supabase || !authUser || !isActiveRemoteMember(groupId, authUser.id)) return;
        setTripStartBusy(true);
        try {
          await startRemoteGroupTrip(supabase, groupDbId, tripId);
          await refreshRemoteGroupData(authUser.id);
          await refreshGroupNotifications();
        } catch (error) {
          const message = error instanceof RemoteGroupApiError && error.code === 'authentication_required'
            ? '로그인이 필요해요. 다시 로그인한 뒤 시도해 주세요.'
            : error instanceof RemoteGroupApiError && error.code === 'group_trip_not_found_or_not_member'
              ? '이 모임의 활성 회원만 여행을 시작할 수 있어요.'
              : error instanceof RemoteGroupApiError && error.code === 'trip_not_startable'
                ? '이 여행은 지금 시작할 수 없어요. 최신 상태를 다시 확인해 주세요.'
                : '여행을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.';
          Alert.alert('여행 시작 실패', message);
        } finally {
          setTripStartBusy(false);
        }
      })(); } },
    ]);
  };

  useEffect(() => {
    if (authStatus !== 'signed-in' || !authUser || !supabase) {
      setSocialState('loading');
      setSocialError('');
      setSocialProfile(null);
      setSocialData(null);
      return;
    }
    let active = true;
    setSocialState('loading');
    setSocialError('');
    loadSocialData(supabase).then((data) => {
      if (!active) return;
      setSocialData(data);
      setSocialProfile(data.profile);
      setNicknameDraft(data.profile.nickname ?? getAccountNickname(authUser));
      setNotificationsEnabled(data.profile.notifications_enabled);
      setSocialState('ready');
    }).catch((error) => {
      if (!active) return;
      setSocialError(error instanceof Error ? error.message : '계정 정보를 불러오지 못했어요.');
      setSocialState('error');
    });
    return () => { active = false; };
  }, [authStatus, authUser?.id]);

  useEffect(() => {
    let active = true;
    if (authStatus !== 'signed-in' || !authUser?.id || !socialProfile?.nickname) {
      setFriendIntroVisible(false);
      return () => { active = false; };
    }
    Storage.getItem(friendIntroStorageKey(authUser.id)).then((value) => {
      if (active) setFriendIntroVisible(value === 'pending');
    }).catch(() => undefined);
    return () => { active = false; };
  }, [authStatus, authUser?.id, socialProfile?.nickname]);

  useEffect(() => {
    if (authStatus !== 'signed-in' || !authUser?.id || !supabase) return;
    const client = supabase;
    const requestedUserId = authUser.id;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void loadSocialData(client).then((data) => {
          if (activeNotificationUser.current === requestedUserId) setSocialData(data);
        }).catch(() => undefined);
        void refreshFriendNotifications();
        setPushRefreshIndex((value) => value + 1);
      }
    });
    return () => subscription.remove();
  }, [authStatus, authUser?.id]);

  useEffect(() => {
    if (authStatus !== 'signed-in' || !authUser?.id || !supabase) {
      setFriendNotifications([]);
      setNotificationState('loading');
      return;
    }
    const client = supabase;
    const userId = authUser.id;
    void refreshFriendNotifications();
    const channel = client.channel(`friend-notifications:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friend_notifications', filter: `recipient_user_id=eq.${userId}` }, () => {
        void refreshFriendNotifications();
        void loadSocialData(client).then((data) => {
          if (activeNotificationUser.current === userId) setSocialData(data);
        }).catch(() => undefined);
      })
      .subscribe();
    const poll = setInterval(() => {
      if (AppState.currentState === 'active') void refreshFriendNotifications();
    }, 30000);
    const received = Notifications.addNotificationReceivedListener(() => { void refreshFriendNotifications(); });
    return () => {
      clearInterval(poll);
      received.remove();
      void client.removeChannel(channel);
    };
  }, [authStatus, authUser?.id]);

  useEffect(() => {
    if (authStatus !== 'signed-in' || !authUser?.id || !supabase) {
      setGroupNotifications([]);
      setGroupNotificationState('loading');
      return;
    }
    const client = supabase;
    const userId = authUser.id;
    const unsubscribe = subscribeGroupNotifications(client, userId, (rows) => {
      if (activeNotificationUser.current !== userId) return;
      const locallyRead = readNotificationIdsByUser.current.get(userId);
      const optimisticReadAt = optimisticGroupReadAtByUser.current.get(userId);
      setGroupNotifications(rows.map((row) => locallyRead?.has(`group:${row.id}`) && !row.readAt
        ? { ...row, readAt: optimisticReadAt?.get(row.id) ?? new Date().toISOString() }
        : row));
      setGroupNotificationState('ready');
    }, () => {
      if (activeNotificationUser.current === userId) setGroupNotificationState('error');
    });
    return unsubscribe;
  }, [authStatus, authUser?.id]);

  useEffect(() => {
    if (authStatus !== 'signed-in' || !authUser?.id || !supabase) return;
    const client = supabase;
    const userId = authUser.id;
    pushOperation.current = pushOperation.current.catch(() => undefined).then(async () => {
      if (signingOut.current || activeNotificationUser.current !== userId) return;
      try {
        await clearStalePushToken(client, userId);
      } catch {
        setPushMessage('이전 계정의 기기 알림을 해제하지 못했어요. 네트워크를 확인한 뒤 다시 시도해 주세요.');
      }
    });
  }, [authStatus, authUser?.id, pushRefreshIndex]);

  useEffect(() => {
    if (authStatus !== 'signed-in' || !authUser?.id || !socialProfile?.nickname || !supabase) return;
    const client = supabase;
    const userId = authUser.id;
    const enabled = socialProfile.notifications_enabled;
    pushOperation.current = pushOperation.current.catch(() => undefined).then(async () => {
      if (signingOut.current || activeNotificationUser.current !== userId) return;
      try {
        if (enabled) {
          const result = await registerPushToken(client, userId);
          setPushMessage(result === 'permission-denied' ? '기기 알림 권한이 꺼져 있어요. 기기 설정에서 허용할 수 있어요.' : '');
        } else {
          await unregisterPushToken(client);
          setPushMessage('');
        }
      } catch (error) {
        if (__DEV__) console.warn('[push notification registration]', error);
        setPushMessage(enabled ? '기기 푸시 알림을 연결하지 못했어요. 앱을 다시 열면 재시도해요.' : '기기 알림 해제를 완료하지 못했어요. 앱을 다시 열면 재시도해요.');
      }
    });
  }, [authStatus, authUser?.id, socialProfile?.nickname, socialProfile?.notifications_enabled, pushRefreshIndex]);

  useEffect(() => {
    if (screen === 'friends' && authStatus === 'signed-in' && authUser?.id && supabase) {
      const requestedUserId = authUser.id;
      void loadSocialData(supabase).then((data) => {
        if (activeNotificationUser.current === requestedUserId) setSocialData(data);
      }).catch(() => {
        if (activeNotificationUser.current === requestedUserId) setFriendMessage('친구 목록을 새로고침하지 못했어요.');
      });
    }
  }, [screen, authStatus, authUser?.id]);

  useEffect(() => {
    if (screen !== 'friends' || !friendSearchVisible) return;
    const timer = setTimeout(() => friendCodeInput.current?.focus(), 120);
    return () => clearTimeout(timer);
  }, [screen, friendSearchVisible]);

  useEffect(() => {
    let active = true;
    const userId = authStatus === 'signed-in' ? authUser?.id : null;
    setProfilePhotoUri(null);
    if (!userId) return () => { active = false; };
    Storage.getItem(profilePhotoStorageKey(userId)).then((uri) => {
      if (active) setProfilePhotoUri(uri);
    }).catch(() => {
      if (active) setProfilePhotoUri(null);
    });
    return () => { active = false; };
  }, [authStatus, authUser?.id]);

  useEffect(() => {
    const userId = authStatus === 'signed-in' ? authUser?.id ?? null : null;
    let active = true;

    setGroups([]);
    setRemoteMemberStatuses({});
    setRemoteMemberAccounts({});
    setRemoteGroupDbIds({});
    setRemoteGroupSnapshotState('loading');
    setDeletedGroupIds([]);
    setStorageError(null);
    setStorageUserId(null);
    setStorageState('loading');

    if (!userId) {
      return () => { active = false; };
    }

    const store = createAccountGroupStore(userId);
    Promise.all([store.loadAll(), store.loadDeletedGroupIds()])
      .then(([savedGroups, savedDeletedGroupIds]) => {
        if (!active) return;
        setDeletedGroupIds(savedDeletedGroupIds);
        const deletedIds = new Set(savedDeletedGroupIds);
        setGroups(savedGroups.filter((item) => !deletedIds.has(item.id)));
        setStorageUserId(userId);
        setStorageState('ready');
      })
      .catch(() => {
        if (!active) return;
        setStorageError('이 계정의 여행 기록을 읽지 못했어요. 기록을 덮어쓰지 않도록 앱을 열지 않았습니다.');
        setStorageState('error');
      });
    return () => { active = false; };
  }, [authStatus, authUser?.id, storageLoadAttempt]);

  useEffect(() => {
    const userId = authStatus === 'signed-in' ? authUser?.id ?? null : null;
    if (!userId || !supabase || storageState !== 'ready' || storageUserId !== userId) {
      setGroupInvitations([]);
      setGroupInvitationState('loading');
      return;
    }
    void refreshRemoteGroupData(userId);
    const unsubscribe = subscribeRemoteGroups(supabase, () => {
      if (activeNotificationUser.current !== userId) return;
      void refreshRemoteGroupData(userId);
      void refreshGroupNotifications();
    }, () => setRemoteGroupSnapshotState('error'));
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refreshRemoteGroupData(userId);
        void refreshGroupNotifications();
      }
    });
    return () => {
      unsubscribe();
      subscription.remove();
    };
  }, [authStatus, authUser?.id, storageState, storageUserId]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const scheduleNextSeoulDay = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        setTripDateNow(new Date());
        scheduleNextSeoulDay();
      }, getMillisecondsUntilNextSeoulDay(new Date()) + 25);
    };
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setTripDateNow(new Date());
        scheduleNextSeoulDay();
      }
    });
    scheduleNextSeoulDay();
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const userId = authStatus === 'signed-in' ? authUser?.id ?? null : null;
    if (storageState !== 'ready' || !userId || storageUserId !== userId) return;
    let active = true;
    createAccountGroupStore(userId).saveAll(groups)
      .then(() => { if (active) setStorageError(null); })
      .catch(() => {
        if (active) setStorageError('기기에 저장하지 못했어요. 앱을 닫기 전에 저장 상태를 확인해 주세요.');
      });
    return () => { active = false; };
  }, [authStatus, authUser?.id, groups, storageState, storageUserId]);

  useEffect(() => {
    const userId = authStatus === 'signed-in' ? authUser?.id ?? null : null;
    if (!userId || storageState !== 'ready' || storageUserId !== userId) return;
    createAccountGroupStore(userId).saveDeletedGroupIds(deletedGroupIds).catch(() => {
      setStorageError('삭제한 모임 목록을 저장하지 못했어요. 다시 시도해 주세요.');
    });
  }, [authStatus, authUser?.id, deletedGroupIds, storageState, storageUserId]);

  useEffect(() => {
    if (!authVerificationPending || authOtpExpiresAt === null) return;
    const updateCountdowns = () => {
      setAuthOtpSecondsRemaining(Math.max(0, Math.ceil((authOtpExpiresAt - Date.now()) / 1000)));
      setAuthResendSecondsRemaining(authResendAvailableAt === null
        ? 0
        : Math.max(0, Math.ceil((authResendAvailableAt - Date.now()) / 1000)));
    };
    updateCountdowns();
    const timer = setInterval(updateCountdowns, 1000);
    return () => clearInterval(timer);
  }, [authVerificationPending, authOtpExpiresAt, authResendAvailableAt]);

  const scrollFocusedInputIntoView = (input: TextInput | null) => {
    if (!input) return;
    setTimeout(() => {
      contentScroll.current?.scrollResponderScrollNativeHandleToKeyboard(input, 112, true);
    }, 120);
  };

  const retryStorageLoad = () => {
    setStorageError(null);
    setStorageState('loading');
    setStorageLoadAttempt((attempt) => attempt + 1);
  };

  const group = groups.find((item) => item.id === selectedGroupId);
  const trip = group?.trips.find((item) => item.id === selectedTripId);
  const setTripSyncOutcomeFor = (groupId: string, tripId: string, outcome: typeof tripSyncOutcome, commandId?: string) => {
    setTripSyncOutcomeTripKey(`${groupId}:${tripId}`);
    setTripSyncOutcome(outcome);
    setTripSyncOutcomeCommandId(commandId ?? null);
  };
  const setTripSyncMessage = (message: string) => {
    setTripSyncMessageTripKey(group && trip ? `${group.id}:${trip.id}` : null);
    setTripSyncMessageState(message);
  };
  const setTripSyncLoadingFor = (groupId: string, tripId: string, loading: boolean) => {
    setTripSyncLoadingTripKey(`${groupId}:${tripId}`);
    setTripSyncLoading(loading);
  };
  const persistTripCommandSnapshot = async (nextGroups: Group[]) => {
    const userId = authStatus === 'signed-in' ? authUser?.id : undefined;
    if (!userId || storageState !== 'ready' || storageUserId !== userId) {
      throw new Error('Local trip data is not ready to save.');
    }
    await createAccountGroupStore(userId).saveAll(nextGroups);
    setGroups(nextGroups);
  };
  useEffect(() => {
    setTripSyncMessage('');
    setTripSyncMessageTripKey(null);
    setTripSyncLoading(false);
    setTripSyncLoadingTripKey(null);
    setTripSyncOutcome(null);
    setTripSyncOutcomeTripKey(null);
    setTripSyncOutcomeCommandId(null);
  }, [screen, selectedGroupId, selectedTripId]);
  const tripTotal = trip?.expenses.reduce((sum, expense) => sum + expense.amount, 0) ?? 0;
  const treasurer = group?.members.find((member) => member.id === trip?.treasurerId);
  const ownerNickname = socialProfile?.nickname ?? getAccountNickname(authUser);
  const currentMemberId = group && authUser?.id
    ? Object.entries(remoteMemberAccounts[group.id] ?? {}).find(([, userId]) => userId === authUser.id)?.[0]
    : undefined;
  const isGroupOwner = Boolean(group && authUser?.id && remoteMemberAccounts[group.id]?.[group.members[0]?.id] === authUser.id);
  const isAccountMember = Boolean(currentMemberId && remoteMemberStatuses[group?.id ?? '']?.[currentMemberId] === 'active');
  const selectedGroupDbId = group ? remoteGroupDbIds[group.id] : undefined;
  const groupActivityKey = group && trip && selectedGroupDbId && authUser?.id
    ? `${group.id}:${selectedGroupDbId}:${trip.id}:${authUser.id}`
    : null;
  useEffect(() => {
    const generation = ++groupActivityGeneration.current;
    let active = true;
    if (screen !== 'trip' || authStatus !== 'signed-in' || !authUser?.id || !supabase || !group || !trip ||
        !selectedGroupDbId || !isAccountMember || remoteGroupSnapshotState !== 'ready') {
      setGroupActivityUi(null);
      return () => { active = false; };
    }
    const requestKey = `${group.id}:${selectedGroupDbId}:${trip.id}:${authUser.id}`;
    setGroupActivityUi({ key: requestKey, status: 'loading', events: [], nextCursor: null, loadingMore: false, moreError: false });
    void listGroupActivity(selectedGroupDbId, { tripId: trip.id, limit: 5 }, supabase).then((page) => {
      if (!active || generation !== groupActivityGeneration.current) return;
      setGroupActivityUi({ key: requestKey, status: 'ready', events: appendGroupActivityPage([], page.events), nextCursor: page.nextCursor, loadingMore: false, moreError: false });
    }).catch((error) => {
      const diagnostic = getGroupActivityRpcDiagnostic(error);
      if (__DEV__ && diagnostic) console.warn('Group activity RPC failed', diagnostic);
      if (!active || generation !== groupActivityGeneration.current) return;
      setGroupActivityUi({ key: requestKey, status: 'error', events: [], nextCursor: null, loadingMore: false, moreError: false });
    });
    return () => { active = false; if (groupActivityGeneration.current === generation) groupActivityGeneration.current += 1; };
  }, [screen, authStatus, authUser?.id, group?.id, trip?.id, selectedGroupDbId, isAccountMember, remoteGroupSnapshotState, groupActivityReload]);
  const loadMoreGroupActivity = async () => {
    const current = groupActivityUi;
    if (!current?.nextCursor || current.status !== 'ready' || current.loadingMore || groupActivityMoreBusy.current ||
        current.key !== groupActivityKey || !group || !trip || !selectedGroupDbId || !supabase ||
        authStatus !== 'signed-in' || !authUser?.id || !isAccountMember || remoteGroupSnapshotState !== 'ready') return;
    const generation = groupActivityGeneration.current; const requestKey = current.key;
    groupActivityMoreBusy.current = true;
    setGroupActivityUi({ ...current, loadingMore: true, moreError: false });
    try {
      const page = await listGroupActivity(selectedGroupDbId, { tripId: trip.id, cursor: current.nextCursor, limit: 5 }, supabase);
      if (generation !== groupActivityGeneration.current) return;
      setGroupActivityUi((latest) => latest?.key !== requestKey ? latest : { ...latest, events: appendGroupActivityPage(latest.events, page.events), nextCursor: page.nextCursor, loadingMore: false, moreError: false });
    } catch (error) {
      const diagnostic = getGroupActivityRpcDiagnostic(error);
      if (__DEV__ && diagnostic) console.warn('Group activity RPC failed', diagnostic);
      if (generation !== groupActivityGeneration.current) return;
      setGroupActivityUi((latest) => latest?.key !== requestKey ? latest : { ...latest, loadingMore: false, moreError: true });
    } finally { groupActivityMoreBusy.current = false; }
  };
  const isActiveRemoteMember = (groupId: string, userId: string) => {
    const memberId = Object.entries(remoteMemberAccounts[groupId] ?? {}).find(([, accountId]) => accountId === userId)?.[0];
    return isRemoteMemberActive(memberId, memberId ? remoteMemberStatuses[groupId]?.[memberId] : undefined);
  };
  const tripStartPrompt = group && trip ? groupNotifications.find((item): item is Extract<RemoteGroupNotification, { type: 'trip_start_prompt' }> => item.type === 'trip_start_prompt' && item.groupId === group.id && item.tripId === trip.id) : undefined;

  const startTripSyncOperation = (key: string) => {
    const operationId = ++tripSyncOperationSequence.current;
    tripSyncOperations.current.set(key, operationId);
    return operationId;
  };

  const finishTripSyncOperation = (key: string, operationId: number) => {
    if (tripSyncOperations.current.get(key) === operationId) tripSyncOperations.current.delete(key);
  };

  const recoverFailedTripSyncEntity = async (args:
    | { kind: 'expense'; groupId: string; tripId: string; dbId: string; expenseId: string; previous?: Expense; optimistic?: Expense; operationKey: string; operationId: number; revisionAtStart: number }
    | { kind: 'settlement'; groupId: string; tripId: string; dbId: string; previous?: string; optimistic?: string; operationKey: string; operationId: number; revisionAtStart: number },
  ) => {
    if (tripSyncOperations.current.get(args.operationKey) !== args.operationId || !supabase) return;
    try {
      const snapshot = await loadRemoteTripSync(supabase, args.dbId, args.tripId);
      const latestRevision = tripSyncRevisions.current.get(`${args.groupId}:${args.tripId}`) ?? -1;
      if (tripSyncOperations.current.get(args.operationKey) !== args.operationId || snapshot.groupRevision < latestRevision) return;
      const tripKey = `${args.groupId}:${args.tripId}`;
      tripSyncRevisions.current.set(tripKey, snapshot.groupRevision);
      tripSyncVersions.current.set(tripKey, { coverVersion: snapshot.coverVersion, settlementVersion: snapshot.settlementVersion });
      setGroups((current) => current.map((item) => item.id !== args.groupId ? item : {
        ...item,
        trips: item.trips.map((existingTrip) => existingTrip.id !== args.tripId ? existingTrip : args.kind === 'expense'
          ? reconcileExpenseFromRemoteSnapshot(existingTrip, snapshot, args.expenseId)
          : reconcileSettlementFromRemoteSnapshot(existingTrip, snapshot)),
      }));
    } catch {
      const tripKey = `${args.groupId}:${args.tripId}`;
      const revisionUnchanged = (tripSyncRevisions.current.get(tripKey) ?? -1) === args.revisionAtStart;
      if (tripSyncOperations.current.get(args.operationKey) !== args.operationId
        || (!revisionUnchanged && (args.kind === 'settlement' || args.optimistic === undefined))) return;
      setGroups((current) => current.map((item) => item.id !== args.groupId ? item : {
        ...item,
        trips: item.trips.map((existingTrip) => existingTrip.id !== args.tripId ? existingTrip : args.kind === 'expense'
          ? rollbackExpenseOperation(existingTrip, args.expenseId, args.previous, args.optimistic)
          : rollbackSettlementOperation(existingTrip, args.previous, args.optimistic)),
      }));
    }
  };

  const applyTripSyncSnapshot = async (snapshot: RemoteTripSyncSnapshot, groupId: string, tripId: string, dbId: string) => {
    const key = `${groupId}:${tripId}`;
    if (snapshot.groupRevision < (tripSyncRevisions.current.get(key) ?? -1)) return;
    tripSyncRevisions.current.set(key, snapshot.groupRevision);
    tripSyncVersions.current.set(key, { coverVersion: snapshot.coverVersion, settlementVersion: snapshot.settlementVersion });
    setGroups((current) => current.map((item) => item.id !== groupId ? item : {
      ...item,
      trips: item.trips.map((existingTrip) => existingTrip.id !== tripId
        ? existingTrip
        : mergeRemoteTripSyncSnapshot(existingTrip, snapshot)),
    }));
    setTripSyncMessage('');

    const cachedPhotoIds = new Set(groups.find((item) => item.id === groupId)?.trips
      .find((item) => item.id === tripId)?.photos?.filter((photo) => photo.uri).map((photo) => photo.id) ?? []);
    const missingPhotos = snapshot.photos.filter((photo) => photo.storageKey && !cachedPhotoIds.has(photo.id));
    if (!supabase || !missingPhotos.length) return;
    await Promise.all(missingPhotos.map(async (photo) => {
      try {
        const bytes = await downloadRemoteTripPhoto(supabase!, photo.storageKey);
        const directory = new Directory(Paths.cache, 'moyeogo-trip-photos', dbId, tripId);
        directory.create({ intermediates: true, idempotent: true });
        const extension = photo.mimeType === 'image/png' ? 'png' : photo.mimeType === 'image/webp' ? 'webp' : 'jpg';
        const file = new File(directory, `${photo.id}.${extension}`);
        file.write(bytes);
        setGroups((current) => current.map((item) => item.id !== groupId ? item : {
          ...item,
          trips: item.trips.map((existingTrip) => existingTrip.id !== tripId ? existingTrip : {
            ...existingTrip,
            photos: (existingTrip.photos ?? []).map((existingPhoto) => existingPhoto.id === photo.id
              && existingPhoto.version === photo.version ? { ...existingPhoto, uri: file.uri } : existingPhoto),
          }),
        }));
      } catch (error) {
        setTripSyncMessage(tripSyncFailureMessage(error, '공유 사진을 이 기기에 내려받지 못했어요.'));
      }
    }));
  };

  useEffect(() => {
    const client = supabase;
    const groupId = group?.id;
    const tripId = trip?.id;
    const dbId = groupId ? remoteGroupDbIds[groupId] : undefined;
    if (authStatus !== 'signed-in' || !authUser?.id || !client || !groupId || !tripId || !dbId || !isAccountMember) {
      setTripSyncLoading(false);
      setTripSyncLoadingTripKey(null);
      setTripSyncMessage('');
      return;
    }
    let active = true;
    setTripSyncLoadingFor(groupId, tripId, true);
    setTripSyncMessage('공유 여행 정보를 불러오는 중…');
    const onSnapshot = (snapshot: RemoteTripSyncSnapshot) => {
      if (!active) return;
      setTripSyncLoadingFor(groupId, tripId, false);
      void applyTripSyncSnapshot(snapshot, groupId, tripId, dbId);
    };
    const unsubscribe = subscribeRemoteTripSync(client, dbId, tripId, onSnapshot, (error) => {
      if (!active) return;
      setTripSyncLoadingFor(groupId, tripId, false);
      setTripSyncMessage(tripSyncFailureMessage(error, '다른 기기와 동기화하지 못했어요.'));
    });
    return () => { active = false; unsubscribe(); };
  }, [authStatus, authUser?.id, group?.id, trip?.id, remoteGroupDbIds[group?.id ?? ''], isAccountMember]);
  const tripRecords = getTripRecords(groups);
  const tripsForCoverOrder = tripRecords.map(({ trip: recordTrip }) => recordTrip);
  const homeTripRecord = tripRecords[0];
  const homeTripCoverPhoto = homeTripRecord ? getTripCoverPhoto(homeTripRecord.trip.photos, homeTripRecord.trip.coverPhotoId) : undefined;
  const homeFallbackOption = getTripFallbackCoverOption(tripsForCoverOrder, 0) ?? 2;
  const geotaggedPhotos = tripRecords.flatMap(({ group: photoGroup, trip: photoTrip }) =>
    (photoTrip.photos ?? [])
      .filter((photo) => photo.latitude !== undefined && photo.longitude !== undefined)
      .map((photo) => ({ group: photoGroup, trip: photoTrip, photo })),
  );
  const mapLatitudes = geotaggedPhotos.map(({ photo }) => photo.latitude as number);
  const mapLongitudes = geotaggedPhotos.map(({ photo }) => photo.longitude as number);
  const mapRegion = geotaggedPhotos.length ? {
    latitude: (Math.min(...mapLatitudes) + Math.max(...mapLatitudes)) / 2,
    longitude: (Math.min(...mapLongitudes) + Math.max(...mapLongitudes)) / 2,
    latitudeDelta: Math.max(0.16, Math.max(...mapLatitudes) - Math.min(...mapLatitudes) + 0.35),
    longitudeDelta: Math.max(0.16, Math.max(...mapLongitudes) - Math.min(...mapLongitudes) + 0.35),
  } : { latitude: 36.5, longitude: 127.8, latitudeDelta: 7.2, longitudeDelta: 7.2 };
  const allExpenseTotal = tripRecords.reduce(
    (sum, record) => sum + record.trip.expenses.reduce((tripSum, expense) => tripSum + expense.amount, 0),
    0,
  );
  const settlementRecords = tripRecords.filter(({ trip: item }) => item.expenses.length > 0);
  const isPrimaryTab = primaryTabs.some((tab) => tab.id === screen);
  const shouldShowBottomNavigation = !['create-group', 'edit-group', 'create-trip', 'edit-trip', 'add-expense', 'edit-expense'].includes(screen);

  const goBack = () => {
    if (screen === 'group' || screen === 'create-group') setScreen(activeTab);
    else if (screen === 'edit-group') setScreen('group');
    else if (screen === 'trip' || screen === 'create-trip') setScreen('group');
    else if (screen === 'edit-trip') setScreen('trip');
    else if (screen === 'settlement') setScreen(settlementReturnScreen);
    else if (screen === 'settlements') setScreen('trips');
    else if (screen === 'add-expense' || screen === 'edit-expense') setScreen('trip');
    else if (screen === 'account') setScreen(accountReturnScreen);
    else if (screen === 'notifications') setScreen(notificationReturnScreen);
  };

  const openAccount = () => {
    if (screen === 'account') return;
    Keyboard.dismiss();
    setAccountReturnScreen(screen);
    setScreen('account');
  };

  const authRedirectUrl = () => ExpoLinking.createURL('auth/callback');

  const getSignupEmail = () => {
    const local = authEmailLocal.trim().replace(/[@\s]/g, '');
    const domain = (authEmailDomain === 'custom' ? authEmailCustomDomain : authEmailDomain)
      .trim()
      .replace(/^@+/, '')
      .replace(/\s/g, '')
      .toLocaleLowerCase();
    return `${local}@${domain}`;
  };

  const startEmailOtpWindow = () => {
    const now = Date.now();
    setAuthOtpExpiresAt(now + 3 * 60 * 1000);
    setAuthResendAvailableAt(now + 60 * 1000);
    setAuthOtpSecondsRemaining(3 * 60);
    setAuthResendSecondsRemaining(60);
  };

  const formatAuthCountdown = (seconds: number) =>
    `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

  const submitEmailAuth = async () => {
    if (!supabase) return;
    const email = authMode === 'sign-up' ? getSignupEmail() : authEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      Alert.alert('이메일을 확인해 주세요', '이메일 아이디와 도메인을 확인해 주세요.');
      return;
    }
    if (authMode === 'sign-up') {
      const passwordError = getSignupPasswordError(authPassword, authPasswordConfirmation);
      if (passwordError) {
        setAuthMessage(passwordError);
        return;
      }
    } else if (!authPassword) {
      Alert.alert('비밀번호를 입력해 주세요', '계정 비밀번호를 입력해 주세요.');
      return;
    }
    setAuthBusy(true);
    setAuthMessage('');
    try {
      if (authMode === 'sign-up') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password: authPassword,
          options: {
            data: { display_name: authName.trim() || email.split('@')[0] },
            emailRedirectTo: authRedirectUrl(),
          },
        });
        if (error) throw error;
        if (isDuplicateSignupResponse(data.user)) {
          setAuthPassword('');
          setAuthPasswordConfirmation('');
          setAuthMode('sign-in');
          setAuthVerificationPending(false);
          setAuthVerificationEmail('');
          setAuthMessage('이미 가입했거나 가입이 진행된 이메일이에요. 로그인 화면으로 전환했어요.');
          return;
        }
        setAuthPassword('');
        setAuthPasswordConfirmation('');
        if (data.session) {
          setAuthUser(data.user ?? null);
          setAuthStatus('signed-in');
          setAuthMessage('계정이 만들어졌어요.');
        } else {
          setAuthVerificationEmail(email);
          setAuthVerificationPending(true);
          setAuthOtp('');
          startEmailOtpWindow();
          setAuthMessage('인증번호를 보냈어요. 이메일에서 6자리 번호를 확인해 주세요.');
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password: authPassword });
        if (error) throw error;
        setAuthUser(data.user ?? null);
        setAuthStatus('signed-in');
        setAuthMessage('로그인되었습니다.');
      }
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : '계정 요청을 처리하지 못했어요.');
    } finally {
      setAuthBusy(false);
    }
  };

  const verifySignupOtp = async () => {
    if (!supabase || !authVerificationEmail) return;
    if (authOtpSecondsRemaining <= 0) {
      setAuthMessage('인증번호가 만료됐어요. 새 인증번호를 받아 주세요.');
      return;
    }
    if (!/^\d{6}$/.test(authOtp)) {
      setAuthMessage('이메일로 받은 6자리 인증번호를 입력해 주세요.');
      return;
    }
    setAuthBusy(true);
    setAuthMessage('');
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: authVerificationEmail,
        token: authOtp,
        type: 'email',
      });
      if (error) throw error;
      setAuthUser(data.user ?? null);
      setAuthStatus(data.session ? 'signed-in' : 'signed-out');
      setAuthVerificationPending(false);
      setAuthVerificationEmail('');
      setAuthOtp('');
      setAuthMessage(data.session ? '이메일 인증이 완료됐어요.' : '이메일 인증이 완료됐어요. 이제 로그인해 주세요.');
      if (!data.session) setAuthMode('sign-in');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      setAuthMessage(/expired|invalid|token/i.test(message)
        ? '인증번호가 올바르지 않거나 만료됐어요. 번호를 다시 확인하거나 새로 받아 주세요.'
        : message || '인증번호를 확인하지 못했어요. 다시 시도해 주세요.');
    } finally {
      setAuthBusy(false);
    }
  };

  const resendSignupOtp = async () => {
    if (!supabase || !authVerificationEmail || authResendSecondsRemaining > 0 || authBusy) return;
    setAuthBusy(true);
    setAuthMessage('');
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: authVerificationEmail,
        options: { emailRedirectTo: authRedirectUrl() },
      });
      if (error) throw error;
      setAuthOtp('');
      startEmailOtpWindow();
      setAuthMessage('새 인증번호를 보냈어요. 이전 번호 대신 새 번호를 입력해 주세요.');
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : '인증번호를 다시 보내지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setAuthBusy(false);
    }
  };

  const returnToSignupForm = () => {
    setAuthVerificationPending(false);
    setAuthVerificationEmail('');
    setAuthOtp('');
    setAuthOtpExpiresAt(null);
    setAuthResendAvailableAt(null);
    setAuthMessage('');
  };

  const signInWithSocial = async (provider: 'google' | 'kakao') => {
    if (!supabase) return;
    setAuthBusy(true);
    setAuthMessage('');
    try {
      const redirectTo = authRedirectUrl();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          skipBrowserRedirect: true,
          queryParams: { prompt: 'select_account' },
        },
      });
      if (error) throw error;
      if (!data.url) throw new Error('로그인 주소를 만들지 못했어요.');
      const providerRedirectTo = new URL(data.url).searchParams.get('redirect_to');
      console.info('[auth redirect check]', { provider, redirectTo, providerRedirectTo });
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type === 'success') {
        const code = new URL(result.url).searchParams.get('code');
        if (!code) throw new Error('인증 완료 코드를 받지 못했어요.');
        if (!processedAuthCodes.current.has(code)) {
          processedAuthCodes.current.add(code);
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        }
        setAuthMessage('로그인되었습니다.');
      }
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : '소셜 로그인을 완료하지 못했어요.');
    } finally {
      setAuthBusy(false);
    }
  };

  const signOut = async () => {
    if (!supabase) return;
    setAuthBusy(true);
    signingOut.current = true;
    try {
      await pushOperation.current;
      if (authUser?.id) await unregisterPushToken(supabase);
    } catch {
      setAuthBusy(false);
      signingOut.current = false;
      setAuthMessage('기기 알림 연결을 해제하지 못했어요. 네트워크를 확인한 뒤 다시 로그아웃해 주세요.');
      return;
    }
    const { error } = await supabase.auth.signOut();
    setAuthBusy(false);
    signingOut.current = false;
    setAuthMessage(error ? error.message : '로그아웃되었습니다.');
  };

  const submitProfile = async (nicknameValue = nicknameDraft, notificationValue = notificationsEnabled) => {
    if (!supabase) return false;
    const nickname = normalizeNickname(nicknameValue);
    const validationError = getNicknameError(nickname);
    if (validationError) {
      setNicknameMessage(validationError);
      return false;
    }
    const currentNickname = normalizeNickname(socialProfile?.nickname ?? '');
    if (nickname !== currentNickname) {
      const available = nicknameCheckedValue === nickname && nicknameCheckState === 'available'
        ? true
        : await checkNicknameAvailability(nickname);
      if (!available) return false;
    }
    setProfileBusy(true);
    setNicknameMessage('');
    try {
      const profile = await saveProfile(supabase, nickname, notificationValue);
      if (!socialProfile?.nickname && authUser?.id) {
        await Storage.setItem(friendIntroStorageKey(authUser.id), 'pending').catch(() => undefined);
        setFriendIntroVisible(true);
      }
      setSocialProfile(profile);
      setNicknameDraft(profile.nickname ?? nickname);
      setNicknameCheckState('idle');
      setNicknameCheckedValue('');
      setNotificationsEnabled(profile.notifications_enabled);
      setSocialState('ready');
      await refreshSocialData();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      setNicknameMessage(message.includes('nickname_taken')
        ? '이미 사용 중인 닉네임이에요. 다른 이름을 입력해 주세요.'
        : message.includes('invalid_nickname')
          ? '닉네임은 한글, 영문, 숫자, 밑줄로 2~16자 입력해 주세요.'
          : '닉네임을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
      return false;
    } finally {
      setProfileBusy(false);
    }
  };

  const toggleNotifications = async () => {
    if (!supabase || !authUser?.id || !socialProfile?.nickname || profileBusy) return;
    const requestedUserId = authUser.id;
    const savedNickname = socialProfile.nickname;
    const nextEnabled = !socialProfile.notifications_enabled;
    setProfileBusy(true);
    try {
      const profile = await saveProfile(supabase, savedNickname, nextEnabled);
      if (activeNotificationUser.current !== requestedUserId) return;
      setSocialProfile(profile);
      setSocialData((current) => current?.profile.user_id === requestedUserId ? { ...current, profile } : current);
      setNotificationsEnabled(profile.notifications_enabled);
      setPushMessage('');
    } catch {
      if (activeNotificationUser.current === requestedUserId) setPushMessage('알림 설정을 저장하지 못했어요. 다시 시도해 주세요.');
    } finally {
      setProfileBusy(false);
    }
  };

  const checkNicknameAvailability = async (value = nicknameDraft): Promise<boolean> => {
    if (!supabase) return false;
    const nickname = normalizeNickname(value);
    const validationError = getNicknameError(nickname);
    if (validationError) {
      setNicknameMessage(validationError);
      setNicknameCheckState('idle');
      setNicknameCheckedValue('');
      return false;
    }
    setNicknameMessage('');
    setNicknameCheckState('checking');
    setNicknameMessage('닉네임 사용 여부를 확인하고 있어요…');
    setNicknameCheckedValue(nickname);
    const sequence = ++nicknameCheckSequence.current;
    try {
      const available = await isNicknameAvailable(supabase, nickname);
      if (sequence !== nicknameCheckSequence.current) return false;
      setNicknameCheckState(available ? 'available' : 'taken');
      setNicknameMessage(available ? '사용할 수 있는 닉네임이에요.' : '이미 사용 중인 닉네임이에요. 다른 이름을 입력해 주세요.');
      return available;
    } catch (error) {
      if (sequence !== nicknameCheckSequence.current) return false;
      setNicknameCheckState('error');
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      setNicknameMessage(message.includes('check_nickname_available') || message.includes('schema cache')
        ? '서버에 중복 확인 기능이 아직 적용되지 않았어요. 서버 업데이트 후 다시 시도해 주세요.'
        : '중복 확인에 실패했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.');
      return false;
    }
  };

  const chooseProfilePhoto = async () => {
    const userId = authStatus === 'signed-in' ? authUser?.id : null;
    if (!userId || profilePhotoBusy) return;
    setProfilePhotoBusy(true);
    let copiedFile: File | null = null;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (result.canceled || !result.assets[0]) return;

      const asset = result.assets[0];
      const candidateExtension = asset.fileName?.match(/\.([a-zA-Z0-9]+)$/)?.[1]
        ?? asset.uri.match(/\.([a-zA-Z0-9]+)(?:\?|$)/)?.[1]
        ?? 'jpg';
      const extension = /^(jpe?g|png|webp|heic)$/i.test(candidateExtension) ? candidateExtension.toLowerCase() : 'jpg';
      const directory = new Directory(Paths.document, 'moyeogo-profile-photos', userId);
      directory.create({ intermediates: true, idempotent: true });
      const destination = new File(directory, `avatar-${Date.now()}.${extension}`);
      copiedFile = destination;
      await new File(asset.uri).copy(destination);
      await Storage.setItem(profilePhotoStorageKey(userId), destination.uri);

      const previousUri = profilePhotoUri;
      setProfilePhotoUri(destination.uri);
      if (previousUri && previousUri !== destination.uri && previousUri.startsWith(Paths.document.uri)) {
        try { new File(previousUri).delete(); } catch { /* Keep the newly saved photo even if old-file cleanup fails. */ }
      }
    } catch {
      try { copiedFile?.delete(); } catch { /* Ignore cleanup errors after a failed copy or save. */ }
      Alert.alert('사진을 저장하지 못했어요', '사진을 다시 선택해 주세요.');
    } finally {
      setProfilePhotoBusy(false);
    }
  };

  const removeProfilePhoto = () => {
    if (!profilePhotoUri || profilePhotoBusy || !authUser?.id) return;
    Alert.alert('프로필 사진을 삭제할까요?', '이 기기에 저장된 프로필 사진을 삭제합니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setProfilePhotoBusy(true);
            try {
              await Storage.removeItem(profilePhotoStorageKey(authUser.id));
              if (profilePhotoUri.startsWith(Paths.document.uri)) new File(profilePhotoUri).delete();
              setProfilePhotoUri(null);
            } catch {
              Alert.alert('사진을 삭제하지 못했어요', '잠시 후 다시 시도해 주세요.');
            } finally {
              setProfilePhotoBusy(false);
            }
          })();
        },
      },
    ]);
  };

  const updateNicknameDraft = (value: string) => {
    nicknameCheckSequence.current += 1;
    setNicknameDraft(value);
    setNicknameMessage('');
    setNicknameCheckState('idle');
    setNicknameCheckedValue('');
  };

  useEffect(() => {
    const nickname = normalizeNickname(nicknameDraft);
    const currentNickname = normalizeNickname(socialProfile?.nickname ?? '');
    if (!nickname) {
      nicknameCheckSequence.current += 1;
      setNicknameMessage('');
      setNicknameCheckState('idle');
      setNicknameCheckedValue('');
      return;
    }
    if (currentNickname && nickname === currentNickname) {
      nicknameCheckSequence.current += 1;
      setNicknameCheckState('available');
      setNicknameCheckedValue(nickname);
      setNicknameMessage('현재 사용 중인 닉네임이에요.');
      return;
    }
    if (nickname.length < 2) {
      nicknameCheckSequence.current += 1;
      setNicknameMessage('');
      setNicknameCheckState('idle');
      setNicknameCheckedValue('');
      return;
    }

    const timeout = setTimeout(() => { void checkNicknameAvailability(nickname); }, 500);
    return () => clearTimeout(timeout);
  }, [nicknameDraft, socialProfile?.nickname]);

  const findFriend = async () => {
    if (!supabase) return;
    setFriendBusy(true);
    setFriendMessage('');
    setFriendSearchResult(null);
    try {
      const result = await searchFriend(supabase, normalizeFriendCode(friendCodeDraft));
      if (!result) setFriendMessage('친구 ID를 찾을 수 없어요. 다시 확인해 주세요.');
      else if (!result.nickname) setFriendMessage('상대가 아직 닉네임 설정을 마치지 않았어요.');
      else setFriendSearchResult(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      setFriendMessage(message.includes('cannot_add_self') ? '내 친구 ID예요.' : '친구를 찾지 못했어요. ID를 확인해 주세요.');
    } finally {
      setFriendBusy(false);
    }
  };

  const requestFriend = async (friendCode: string) => {
    if (!supabase) return;
    setFriendBusy(true);
    setFriendMessage('');
    try {
      await sendFriendRequest(supabase, friendCode);
      setFriendMessage('친구 요청을 보냈어요. 상대가 수락하면 친구 목록에 표시돼요.');
      setFriendSearchResult(null);
      await refreshSocialData();
      setFriendSection('sent');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const readable = message.includes('already_friends') ? '이미 친구예요.'
        : message.includes('incoming_request_exists') ? '상대가 보낸 친구 요청을 아래 요청 목록에서 확인해 주세요.'
          : message.includes('friend_request_exists') ? '이미 친구 요청을 보냈어요.'
            : message.includes('friend_not_found') ? '친구 ID를 찾을 수 없어요.' : '친구 요청을 보내지 못했어요.';
      setFriendMessage(readable);
      await refreshSocialData().catch(() => undefined);
    } finally {
      setFriendBusy(false);
    }
  };

  const handleFriendRequest = async (requestId: string, accept: boolean, notificationId?: string) => {
    if (!supabase) return;
    setFriendBusy(true);
    setFriendMessage('');
    try {
      await respondFriendRequest(supabase, requestId, accept);
      setFriendMessage(accept ? '친구 요청을 수락했어요.' : '친구 요청을 거절했어요.');
      setFriendSearchResult(null);
      await refreshSocialData();
      if (notificationId) {
        void markFriendNotificationAsRead(notificationId);
        setNotificationMessage(accept ? '친구 요청을 수락했어요.' : '친구 요청을 거절했어요.');
      }
      if (accept) setFriendSection('friends');
    } catch {
      setFriendMessage('친구 요청을 처리하지 못했어요. 새로고침 후 다시 시도해 주세요.');
      if (notificationId) setNotificationMessage('친구 요청을 처리하지 못했어요. 다시 시도해 주세요.');
    } finally {
      setFriendBusy(false);
    }
  };

  const handleCancelFriendRequest = async (requestId: string) => {
    if (!supabase) return;
    setFriendBusy(true);
    setFriendMessage('');
    try {
      await cancelFriendRequest(supabase, requestId);
      setFriendSearchResult(null);
      await refreshSocialData();
      setFriendMessage('보낸 친구 요청을 취소했어요.');
    } catch {
      setFriendMessage('요청을 취소하지 못했어요. 다시 시도해 주세요.');
    } finally {
      setFriendBusy(false);
    }
  };

  const handleRemoveFriend = (friend: FriendEntry) => {
    Alert.alert('친구 삭제', `${friend.nickname}님을 친구 목록에서 삭제할까요? 다시 친구가 되려면 요청을 보내야 해요.`, [
      { text: '유지', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => {
        if (!supabase) return;
        setFriendBusy(true);
        setFriendMessage('');
        void removeFriend(supabase, friend.user_id).then(() => { setFriendSearchResult(null); return refreshSocialData(); }).then(() => {
          setFriendMessage(`${friend.nickname}님을 친구 목록에서 삭제했어요.`);
        }).catch(() => {
          setFriendMessage('친구를 삭제하지 못했어요. 다시 시도해 주세요.');
        }).finally(() => setFriendBusy(false));
      } },
    ]);
  };

  const shareMyFriendId = () => {
    if (socialProfile?.friend_code) void Share.share({ message: `모여Go에서 친구로 연결해요. 내 ID는 ${socialProfile.friend_code}예요.` });
  };

  const openFriends = (section: 'friends' | 'received' | 'sent' = 'friends', search = false) => {
    setFriendSection(section);
    setFriendSearchVisible(search);
    setFriendMessage('');
    setFriendCodeDraft('');
    setFriendSearchResult(null);
    setActiveTab('friends');
    setScreen('friends');
  };

  const openNotifications = () => {
    Keyboard.dismiss();
    if (screen !== 'notifications') setNotificationReturnScreen(screen);
    setScreen('notifications');
    void refreshFriendNotifications();
    void refreshGroupNotifications();
  };

  const rememberReadNotification = (type: 'friend' | 'group', notificationId: string) => {
    if (!authUser?.id) return;
    const userReadIds = readNotificationIdsByUser.current.get(authUser.id) ?? new Set<string>();
    userReadIds.add(`${type}:${notificationId}`);
    readNotificationIdsByUser.current.set(authUser.id, userReadIds);
  };

  const markFriendNotificationAsRead = async (notificationId: string) => {
    if (!supabase || !authUser?.id) return;
    rememberReadNotification('friend', notificationId);
    setFriendNotifications((current) => current.map((item) => item.id === notificationId ? { ...item, read_at: item.read_at ?? new Date().toISOString() } : item));
    try {
      await markFriendNotificationRead(supabase, notificationId);
    } catch {
      readNotificationIdsByUser.current.get(authUser.id)?.delete(`friend:${notificationId}`);
      void refreshFriendNotifications();
    }
  };

  const markGroupNotificationAsRead = (notificationId: string) => {
    if (!supabase || !authUser?.id) return Promise.resolve();
    const requestedUserId = authUser.id;
    const requestKey = `${requestedUserId}:group:${notificationId}`;
    const existingRequest = groupReadRequests.current.get(requestKey);
    if (existingRequest) return existingRequest;

    const previousReadAt = groupNotifications.find((item) => item.id === notificationId)?.readAt ?? null;
    const locallyReadIds = readNotificationIdsByUser.current.get(requestedUserId);
    const wasLocallyRead = locallyReadIds?.has(`group:${notificationId}`) ?? false;
    const optimisticReadAt = `optimistic:${requestedUserId}:${notificationId}:${++groupReadRequestSequence.current}`;
    const optimisticReadAtById = optimisticGroupReadAtByUser.current.get(requestedUserId) ?? new Map<string, string>();
    optimisticReadAtById.set(notificationId, optimisticReadAt);
    optimisticGroupReadAtByUser.current.set(requestedUserId, optimisticReadAtById);
    const request = (async () => {
      rememberReadNotification('group', notificationId);
      setGroupNotifications((current) => current.map((item) => item.id === notificationId ? { ...item, readAt: item.readAt ?? optimisticReadAt } : item));
      try {
        await markGroupNotificationRead(notificationId);
      } catch {
        const userReadIds = readNotificationIdsByUser.current.get(requestedUserId);
        if (wasLocallyRead) userReadIds?.add(`group:${notificationId}`);
        else userReadIds?.delete(`group:${notificationId}`);
        const userOptimisticReadAt = optimisticGroupReadAtByUser.current.get(requestedUserId);
        if (userOptimisticReadAt?.get(notificationId) === optimisticReadAt) userOptimisticReadAt.delete(notificationId);
        if (activeNotificationUser.current === requestedUserId) {
          setGroupNotifications((current) => current.map((item) => item.id === notificationId && item.readAt === optimisticReadAt
            ? { ...item, readAt: previousReadAt }
            : item));
          void refreshGroupNotifications();
        }
      } finally {
        groupReadRequests.current.delete(requestKey);
      }
    })();
    groupReadRequests.current.set(requestKey, request);
    return request;
  };

  const unreadNotificationCount = friendNotifications.filter((notification) => !notification.read_at).length + groupNotifications.filter((notification) => !notification.readAt).length;
  const renderBellButton = (atIntro = false) => <Pressable onPress={openNotifications} style={[styles.headerBellButton, atIntro && styles.introBellButton]} accessibilityRole="button" accessibilityLabel={`알림${unreadNotificationCount ? `, 읽지 않은 알림 ${unreadNotificationCount}개` : ''}`} accessibilityState={{ selected: screen === 'notifications' }}>
    <View style={styles.bellIcon}><View style={styles.bellBody} /><View style={styles.bellClapper} /></View>
    {unreadNotificationCount ? <View style={styles.headerBellBadge}><Text style={styles.headerBellBadgeText}>{Math.min(99, unreadNotificationCount)}</Text></View> : null}
  </Pressable>;

  const openFriendNotification = (notification: FriendNotification) => {
    if (!notification.read_at) void markFriendNotificationAsRead(notification.id);
    openFriends(notification.kind === 'friend_request' ? 'received' : 'friends');
  };

  useEffect(() => {
    if (authStatus !== 'signed-in' || !authUser?.id) return;
    const openFromPush = (response: Notifications.NotificationResponse | null) => {
      const kind = response?.notification.request.content.data?.kind;
      if (kind === 'friend_request' || kind === 'friend_accepted') openNotifications();
    };
    const responseSubscription = Notifications.addNotificationResponseReceivedListener(openFromPush);
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      openFromPush(response);
      void Notifications.clearLastNotificationResponseAsync();
    }).catch(() => undefined);
    return () => responseSubscription.remove();
  }, [authStatus, authUser?.id]);

  const finishFriendIntro = async (action: 'home' | 'find' | 'share') => {
    if (authUser?.id) await Storage.setItem(friendIntroStorageKey(authUser.id), 'done').catch(() => undefined);
    setFriendIntroVisible(false);
    if (action === 'find') openFriends('friends', true);
    else {
      setActiveTab('home');
      setScreen('home');
      if (action === 'share') shareMyFriendId();
    }
  };

  const renderFriendIntro = () => (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.authGateHeader}><BrandLogo editorial />{renderBellButton(true)}</View>
      <View style={styles.friendIntroContent}>
        <Text style={styles.eyebrow}>TOGETHER</Text>
        <Text style={styles.screenTitle}>친구와 함께 시작해요</Text>
        <Text style={styles.screenDescription}>친구를 연결해 두면 모임을 만들 때 목록에서 여러 명을 쉽게 고를 수 있어요.</Text>
        <PrimaryButton title="친구 ID로 찾기" onPress={() => { void finishFriendIntro('find'); }} />
        <SecondaryButton title="내 ID 공유" onPress={() => { void finishFriendIntro('share'); }} />
        <Pressable style={styles.authModeSwitch} onPress={() => { void finishFriendIntro('home'); }} accessibilityRole="button">
          <Text style={styles.authModeSwitchAction}>나중에 할게요</Text>
        </Pressable>
        <Text style={styles.friendIntroHint}>언제든 하단 친구 탭과 내 계정에서 친구를 관리할 수 있어요.</Text>
      </View>
    </SafeAreaView>
  );

  const renderNicknameSetup = () => (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.authGateHeader}><BrandLogo editorial />{renderBellButton(true)}</View>
      <ScrollView contentContainerStyle={styles.authGateContent} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Text style={styles.screenTitle}>어떤 이름으로 불러드릴까요?</Text>
        <Text style={styles.screenDescription}>모임과 친구 목록에 표시할 닉네임을 정해 주세요. 닉네임은 다른 계정과 겹칠 수 없어요.</Text>
        <Field label="사용할 닉네임" value={nicknameDraft} onChangeText={updateNicknameDraft} placeholder="예: 여행하는모여" autoCapitalize="none" />
        {nicknameMessage ? <Text style={nicknameCheckState === 'available' ? styles.formSuccess : nicknameCheckState === 'checking' ? styles.nicknameCheckPending : styles.nicknameCheckError}>{nicknameMessage}</Text> : null}
        <PrimaryButton title={profileBusy ? '저장 중…' : '닉네임 저장하고 시작하기'} onPress={() => { void submitProfile(); }} />
        <Pressable style={styles.authModeSwitch} onPress={() => { void signOut(); }} accessibilityRole="button">
          <Text style={styles.authModeSwitchAction}>로그아웃</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );

  const renderAccountPanel = () => (
    <>
      <View style={styles.accountProfileCard}>
        <Pressable style={styles.accountAvatar} onPress={() => { void chooseProfilePhoto(); }} disabled={profilePhotoBusy} accessibilityRole="button" accessibilityLabel={profilePhotoUri ? '프로필 사진 변경' : '프로필 사진 추가'}>
          {profilePhotoUri ? <Image source={{ uri: profilePhotoUri }} style={styles.accountAvatarImage} /> : <Text style={styles.accountAvatarText}>{socialProfile?.nickname?.slice(0, 1) ?? '모'}</Text>}
          <View style={styles.accountAvatarEditBadge}><Text style={styles.accountAvatarEditText}>{profilePhotoBusy ? '…' : '+'}</Text></View>
        </Pressable>
        <View style={styles.accountIdentity}>
          <Text style={styles.accountProfileName}>{socialProfile?.nickname ?? '내 프로필'}</Text>
          <Text style={styles.accountEmail}>{authUser?.email ?? '이메일 정보 없음'}</Text>
          <View style={styles.accountPhotoActions}>
            <Pressable onPress={() => { void chooseProfilePhoto(); }} disabled={profilePhotoBusy} style={styles.accountPhotoAction} accessibilityRole="button">
              <Text style={styles.accountPhotoActionText}>{profilePhotoBusy ? '사진 저장 중…' : profilePhotoUri ? '사진 변경' : '사진 추가'}</Text>
            </Pressable>
            {profilePhotoUri ? <Pressable onPress={removeProfilePhoto} disabled={profilePhotoBusy} style={styles.accountPhotoAction} accessibilityRole="button"><Text style={styles.accountPhotoRemoveText}>삭제</Text></Pressable> : null}
          </View>
          <Text style={styles.accountPhotoHint}>사진은 이 기기에 저장돼요.</Text>
        </View>
      </View>

      <Text style={styles.accountSectionHeading}>프로필</Text>
      <View style={styles.accountSettingsCard}>
        <Text style={styles.fieldLabel}>닉네임</Text>
        <Field label="변경할 닉네임" value={nicknameDraft} onChangeText={updateNicknameDraft} placeholder="닉네임" />
        {nicknameMessage ? <Text style={nicknameCheckState === 'available' ? styles.formSuccess : nicknameCheckState === 'checking' ? styles.nicknameCheckPending : styles.nicknameCheckError}>{nicknameMessage}</Text> : null}
        <PrimaryButton title={profileBusy ? '저장 중…' : '저장'} onPress={() => { void submitProfile(); }} compact accountCompact />
      </View>

      <Text style={styles.accountSectionHeading}>친구 연결</Text>
      <View style={styles.accountSettingsCard}>
        <Text style={styles.accountRowTitle}>내 ID</Text>
        <Text style={styles.accountRowDescription}>친구가 이 ID로 나를 찾아 친구 요청을 보낼 수 있어요.</Text>
        <View style={styles.friendCodeShareRow}>
          <View style={styles.friendCodeValue}><Text style={styles.friendCodeText}>{socialProfile?.friend_code ?? '불러오는 중…'}</Text></View>
          <SecondaryButton title="공유" compact accountCompact onPress={shareMyFriendId} />
        </View>
        <View style={styles.accountDivider} />
        <Pressable style={styles.accountNavigationRow} onPress={() => openFriends()} accessibilityRole="button">
          <View><Text style={styles.accountRowTitle}>친구 관리</Text><Text style={styles.accountRowDescription}>친구 찾기와 요청 확인</Text></View>
          <Text style={styles.accountChevron}>›</Text>
        </Pressable>
      </View>

      <Text style={styles.accountSectionHeading}>앱 설정</Text>
      <View style={styles.accountSettingsCard}>
        <Pressable
          style={styles.accountToggleRow}
          onPress={() => { void toggleNotifications(); }}
          disabled={profileBusy}
          accessibilityRole="switch"
          accessibilityState={{ checked: notificationsEnabled }}
        >
          <View style={styles.accountToggleCopy}><Text style={styles.accountRowTitle}>알림 받기</Text><Text style={styles.accountRowDescription}>친구 요청과 수락 알림 설정</Text></View>
          <View style={[styles.settingToggle, notificationsEnabled && styles.settingToggleOn]}><View style={[styles.settingToggleKnob, notificationsEnabled && styles.settingToggleKnobOn]} /></View>
        </Pressable>
        {pushMessage ? <Text style={styles.accountFootnote} accessibilityLiveRegion="polite">{pushMessage}</Text> : null}
      </View>

      <Pressable style={styles.logoutButton} onPress={() => { void signOut(); }} disabled={authBusy} accessibilityRole="button">
        <Text style={styles.logoutButtonText}>{authBusy ? '로그아웃 중…' : '로그아웃'}</Text>
      </Pressable>
      <Text style={styles.accountFootnote}>여행 기록은 현재 이 기기에 저장돼요.</Text>
    </>
  );

  const renderNotificationsPanel = () => (
    <>
      <Text style={styles.screenTitle}>알림</Text>
      <Text style={styles.accountRowDescription}>친구 요청과 수락 소식을 확인해요.</Text>
      <SectionTitle title="모임 알림" trailing={groupNotifications.length ? `${groupNotifications.length}개` : undefined} onRefresh={() => { void refreshGroupNotifications(); }} />
      {groupNotificationState === 'loading' ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 12 }} /> : null}
      {groupNotificationState === 'error' ? <View style={styles.accountCard}><Text style={styles.accountRowDescription}>모임 알림을 불러오지 못했어요.</Text><SecondaryButton title="다시 시도" compact onPress={() => { void refreshGroupNotifications(); }} /></View> : null}
      {groupNotificationState === 'ready' && groupNotifications.length === 0 ? <Text style={styles.groupInvitationEmpty}>새 모임 알림이 없어요.</Text> : null}
      {groupNotificationState === 'ready' && groupNotifications.map((notification) => {
        const isInvitation = notification.type === 'group_invitation';
        const isAccepted = notification.type === 'invitation_accepted';
        const isTripStarted = notification.type === 'trip_started';
        const isTripCreated = notification.type === 'trip_created';
        const isTripStartPrompt = notification.type === 'trip_start_prompt';
        const promptGroup = isTripStartPrompt ? groups.find((item) => item.id === notification.groupId) : undefined;
        const promptMemberId = promptGroup && authUser?.id
          ? Object.entries(remoteMemberAccounts[promptGroup.id] ?? {}).find(([, userId]) => userId === authUser.id)?.[0]
          : undefined;
        const canStartPromptTrip = Boolean(authUser && promptMemberId && remoteGroupSnapshotState === 'ready' && remoteMemberStatuses[notification.groupId]?.[promptMemberId] === 'active');
        if (isTripStartPrompt && !canStartPromptTrip) return null;
        const title = isTripStartPrompt ? '여행 시작할까요?' : isTripCreated ? '새 여행이 추가됐어요' : isTripStarted ? '여행 시작' : isInvitation ? '모임 초대' : isAccepted ? '초대 수락' : '모임 탈퇴';
        const body = isTripCreated
          ? `${notification.groupName} 모임에 ${notification.tripName} 여행이 추가됐어요. 여행 상세를 확인해 보세요.`
          : isTripStarted
          ? `${notification.tripName} 여행이 시작됐어요.`
          : isTripStartPrompt
            ? `${notification.tripName} 여행 예정일이에요. 시작하려면 아래 버튼을 눌러 주세요.`
          : isInvitation
            ? notification.groupName + ' 모임에 ' + notification.memberName + ' 이름으로 초대됐어요. 모임 탭에서 내용을 확인하고 수락할 수 있어요.'
            : isAccepted
              ? notification.groupName + ' 모임 초대를 ' + notification.memberName + '님이 수락했어요.'
              : notification.groupName + '에서 ' + notification.memberName + '님이 탈퇴했어요.';
        const isRead = Boolean(notification.readAt);
        return <View key={notification.id} style={styles.notificationCard}>
          <Pressable onPress={() => { if (!isRead) void markGroupNotificationAsRead(notification.id); if (isInvitation) { setActiveTab('groups'); setScreen('groups'); } else if (isTripCreated) { void (async () => { if (supabase && authUser?.id) await refreshRemoteGroupData(authUser.id); openTrip(notification.groupId, notification.tripId); })(); } else if (isTripStarted || isTripStartPrompt) openTrip(notification.groupId, notification.tripId); else openGroup(notification.groupId); }} style={styles.notificationEntry} accessibilityRole="button" accessibilityLabel={title + ': ' + body + (isRead ? ', 읽음' : ', 읽지 않음')}>
            <View style={styles.notificationCopy}>
              <View style={styles.notificationTitleRow}><Text style={styles.notificationTitle}>{title}</Text>{!isRead ? <View style={styles.notificationUnreadDot} /> : null}{!isRead ? <Text style={styles.notificationStatus}>읽지 않음</Text> : null}</View>
              <Text style={styles.notificationBody}>{body}</Text>
              <Text style={styles.notificationDate}>{new Date(notification.createdAt).toLocaleString('ko-KR')}</Text>
            </View>
            {isInvitation ? <Text style={styles.groupInvitationAcceptText}>초대 확인</Text> : isTripStartPrompt ? <Text style={styles.groupInvitationAcceptText}>여행 시작</Text> : <Text style={styles.accountChevron}>›</Text>}
          </Pressable>
          {isTripStartPrompt ? <View style={styles.notificationActions}><PrimaryButton title="여행 시작" compact disabled={tripStartBusy} onPress={() => { void markGroupNotificationAsRead(notification.id); confirmStartTrip(notification.groupDbId, notification.groupId, notification.tripId); }} /></View> : null}
        </View>;
      })}
      {notificationState === 'loading' ? <ActivityIndicator color={colors.primary} style={{ marginTop: 30 }} /> : null}
      {notificationState === 'error' ? <View style={styles.accountCard}>
        <Text style={styles.accountRowDescription}>{notificationMessage}</Text>
        <SecondaryButton title="다시 시도" compact onPress={() => { void refreshFriendNotifications(); }} />
      </View> : null}
      {notificationState === 'ready' && friendNotifications.length === 0 ? <View style={styles.accountCard}>
        <Text style={styles.friendEmptyTitle}>아직 알림이 없어요</Text>
        <Text style={styles.accountRowDescription}>친구 요청이 오거나 수락되면 여기에 표시돼요.</Text>
      </View> : null}
      {notificationState === 'ready' && friendNotifications.map((notification) => {
        const pendingRequest = notification.kind === 'friend_request'
          ? socialData?.requests.find((request) => request.id === notification.source_request_id && request.direction === 'incoming')
          : null;
        const isFriend = (socialData?.friends ?? []).some((friend) => friend.user_id === notification.actor_user_id);
        return <View key={notification.id} style={styles.notificationCard}>
          <Pressable onPress={() => openFriendNotification(notification)} style={styles.notificationEntry} accessibilityRole="button" accessibilityLabel={`${notification.actor_nickname}님의 ${notification.kind === 'friend_request' ? '친구 요청' : '친구 수락'} 알림${notification.read_at ? '' : ', 읽지 않음'}`}>
            <View style={styles.notificationCopy}>
              <View style={styles.notificationTitleRow}>
                <Text style={styles.notificationTitle}>{notification.kind === 'friend_request' ? '친구 요청' : '친구 요청 수락'}</Text>
                {!notification.read_at ? <View style={styles.notificationUnreadDot} /> : null}
              </View>
              <Text style={styles.notificationBody}>{notification.kind === 'friend_request'
                ? `${notification.actor_nickname}님이 친구 요청을 보냈어요.`
                : `${notification.actor_nickname}님이 친구 요청을 수락했어요.`}</Text>
              <Text style={styles.notificationDate}>{new Date(notification.created_at).toLocaleString('ko-KR')}</Text>
            </View>
            <Text style={styles.accountChevron}>›</Text>
          </Pressable>
          {pendingRequest ? <View style={styles.notificationActions}>
            <SecondaryButton title="수락" compact disabled={friendBusy} onPress={() => { void handleFriendRequest(pendingRequest.id, true, notification.id); }} />
            <Pressable onPress={() => { void handleFriendRequest(pendingRequest.id, false, notification.id); }} disabled={friendBusy} style={styles.rejectAction} accessibilityRole="button"><Text style={styles.rejectActionText}>거절</Text></Pressable>
          </View> : notification.kind === 'friend_request' ? <Text style={styles.notificationStatus}>{isFriend ? '이미 친구가 되었어요.' : '요청을 처리했거나 취소했어요.'}</Text> : null}
        </View>;
      })}
      {notificationState === 'ready' && notificationMessage ? <Text style={styles.friendFeedback} accessibilityLiveRegion="polite">{notificationMessage}</Text> : null}
    </>
  );

  const renderFriendsPanel = () => {
    const requests = socialData?.requests ?? [];
    const friends = socialData?.friends ?? [];
    const incoming = requests.filter((request) => request.direction === 'incoming');
    const outgoing = requests.filter((request) => request.direction === 'outgoing');
    return <>
      <Text style={styles.screenTitle}>친구 관리</Text>
      <Text style={styles.screenDescription}>친구 ID로 연결하고, 받은 요청과 보낸 요청을 확인하세요.</Text>
      <Pressable style={styles.friendAddAction} onPress={() => {
        setFriendSearchVisible((visible) => !visible);
      }} accessibilityRole="button">
        <Text style={styles.friendAddActionText}>{friendSearchVisible ? '친구 찾기 닫기' : '+ 친구 추가'}</Text>
      </Pressable>
      <Pressable style={styles.friendMyIdRow} onPress={shareMyFriendId} accessibilityRole="button" accessibilityLabel={`내 ID ${socialProfile?.friend_code ?? ''} 공유`}>
        <Text style={styles.friendMyIdText}>내 ID  {socialProfile?.friend_code ?? '불러오는 중…'}</Text>
        <Text style={styles.friendMyIdShare}>공유 ›</Text>
      </Pressable>
      {friendSearchVisible ? <View style={styles.accountCard}>
        <Field label="친구 ID로 찾기" value={friendCodeDraft} onChangeText={(value) => { setFriendCodeDraft(value); setFriendSearchResult(null); setFriendMessage(''); }} placeholder="예: MG-A1B2C3D4" autoCapitalize="characters" inputRef={friendCodeInput} returnKeyType="search" onSubmitEditing={() => { void findFriend(); }} />
        <PrimaryButton title={friendBusy ? '확인 중…' : '친구 찾기'} onPress={() => { void findFriend(); }} compact />
        {friendSearchResult ? (
          <View style={styles.friendResultCard}>
            <View style={styles.cardMain}><Text style={styles.friendName}>{friendSearchResult.nickname}</Text><Text style={styles.helperText}>{friendSearchResult.friend_code}</Text></View>
            {friendSearchResult.relation_status === 'accepted' ? <Text style={styles.requestStatus}>친구</Text>
              : friendSearchResult.relation_status === 'pending' ? <Pressable onPress={() => setFriendSection(requests.some((request) => request.user_id === friendSearchResult.user_id && request.direction === 'incoming') ? 'received' : 'sent')} style={styles.rejectAction} accessibilityRole="button"><Text style={styles.rejectActionText}>요청 확인</Text></Pressable>
                : <SecondaryButton title="요청 보내기" compact disabled={friendBusy} onPress={() => { void requestFriend(friendSearchResult.friend_code); }} />}
          </View>
        ) : null}
      </View> : null}
      {friendMessage ? <Text style={styles.friendFeedback} accessibilityLiveRegion="polite">{friendMessage}</Text> : null}
      <View style={styles.friendTabs}>
        {([
          ['friends', `내 친구 ${friends.length}`],
          ['received', `받은 요청 ${incoming.length}`],
          ['sent', `보낸 요청 ${outgoing.length}`],
        ] as const).map(([section, label]) => <Pressable key={section} onPress={() => setFriendSection(section)} style={[styles.friendTab, friendSection === section && styles.friendTabSelected]} accessibilityRole="tab" accessibilityState={{ selected: friendSection === section }}><Text style={[styles.friendTabText, friendSection === section && styles.friendTabTextSelected]}>{label}</Text></Pressable>)}
      </View>
      {friendSection === 'friends' ? <View style={styles.accountCard}>
        {friends.length === 0 ? <>
          <Text style={styles.friendEmptyTitle}>아직 연결된 친구가 없어요</Text>
          <Text style={styles.helperText}>친구 ID로 찾아 요청을 보내거나 내 ID를 공유해 보세요.</Text>
          <SecondaryButton title="내 ID 공유" compact onPress={shareMyFriendId} />
        </> : null}
        {friends.map((friend) => <View key={friend.user_id} style={styles.friendResultCard}><View style={styles.cardMain}><Text style={styles.friendName}>{friend.nickname}</Text><Text style={styles.helperText}>{friend.friend_code}</Text></View><Pressable onPress={() => handleRemoveFriend(friend)} disabled={friendBusy} style={styles.rejectAction} accessibilityRole="button" accessibilityLabel={`${friend.nickname} 친구 삭제`}><Text style={styles.rejectActionText}>삭제</Text></Pressable></View>)}
      </View> : null}
      {friendSection === 'received' ? <View style={styles.accountCard}>
        {incoming.length === 0 ? <Text style={styles.helperText}>새로 받은 친구 요청이 없어요.</Text> : null}
        {incoming.map((request) => (
          <View key={request.id} style={styles.friendResultCard}>
            <View style={styles.cardMain}><Text style={styles.friendName}>{request.nickname}</Text><Text style={styles.helperText}>{request.friend_code}</Text></View>
            <SecondaryButton title="수락" compact disabled={friendBusy} onPress={() => { void handleFriendRequest(request.id, true); }} />
            <Pressable onPress={() => { void handleFriendRequest(request.id, false); }} disabled={friendBusy} style={styles.rejectAction}><Text style={styles.rejectActionText}>거절</Text></Pressable>
          </View>
        ))}
      </View> : null}
      {friendSection === 'sent' ? <View style={styles.accountCard}>
        {outgoing.length === 0 ? <Text style={styles.helperText}>기다리는 친구 요청이 없어요.</Text> : null}
        {outgoing.map((request) => <View key={request.id} style={styles.friendResultCard}><View style={styles.cardMain}><Text style={styles.friendName}>{request.nickname}</Text><Text style={styles.helperText}>{request.friend_code} · 수락 대기 중</Text></View><Pressable onPress={() => { void handleCancelFriendRequest(request.id); }} disabled={friendBusy} style={styles.rejectAction} accessibilityRole="button"><Text style={styles.rejectActionText}>요청 취소</Text></Pressable></View>)}
      </View> : null}
    </>;
  };

  const renderAuthPanel = () => (
    <>
      {authUser ? (
        <>
          <Text style={styles.screenTitle}>내 계정</Text>
          <Text style={styles.screenDescription}>이 계정의 모임과 여행은 이 기기에 따로 저장됩니다. 로그인 전 기록은 지우지 않고 보관하지만, 계정으로 가져오기와 다른 기기 동기화는 아직 지원하지 않아요.</Text>
        </>
      ) : (
        <>
          <Text style={styles.authHeadline}>친구와의 여행을,{ '\n' }모여Go에 담아요.</Text>
          <Text style={styles.authDescription}>로그인하고 함께한 순간을 기록해 보세요.</Text>
        </>
      )}
      {!isSupabaseConfigured ? (
        <View style={styles.storageWarning}>
          <Text style={styles.storageWarningText}>Supabase 프로젝트 설정이 필요해요. 프로젝트 URL과 publishable key를 로컬 .env에 설정한 뒤 앱을 다시 실행해 주세요.</Text>
        </View>
      ) : authUser ? (
        <View style={styles.accountCard}>
          <Text style={styles.fieldLabel}>로그인된 계정</Text>
          <Text style={styles.accountEmail}>{authUser.email ?? '이메일 정보 없음'}</Text>
          <PrimaryButton title={authBusy ? '처리 중…' : '로그아웃'} onPress={() => { void signOut(); }} />
        </View>
      ) : (
        authVerificationPending ? (
          <>
            <Text style={styles.screenTitle}>이메일 인증</Text>
            <Text style={styles.screenDescription}>
              {authVerificationEmail}로 보낸 6자리 인증번호를 입력해 주세요.{ '\n' }
              남은 시간 {formatAuthCountdown(authOtpSecondsRemaining)}
            </Text>
            <Field
              label="인증번호"
              value={authOtp}
              onChangeText={(value) => setAuthOtp(value.replace(/\D/g, '').slice(0, 6))}
              placeholder="6자리 숫자"
              keyboardType="number-pad"
              inputRef={authOtpInput}
              onFocus={() => scrollFocusedInputIntoView(authOtpInput.current)}
            />
            <PrimaryButton
              title={authBusy ? '확인 중…' : '이메일 인증하기'}
              onPress={() => { void verifySignupOtp(); }}
            />
            <Pressable
              onPress={() => { void resendSignupOtp(); }}
              disabled={authBusy || authResendSecondsRemaining > 0}
              style={styles.authModeSwitch}
              accessibilityRole="button"
              accessibilityLabel="인증번호 다시 보내기"
            >
              <Text style={[styles.authModeSwitchAction, (authBusy || authResendSecondsRemaining > 0) && styles.disabledText]}>
                {authBusy ? '전송 중…' : authResendSecondsRemaining > 0
                  ? `인증번호 다시 받기 ${formatAuthCountdown(authResendSecondsRemaining)}`
                  : '인증번호 다시 받기'}
              </Text>
            </Pressable>
            <Pressable onPress={returnToSignupForm} style={styles.authModeSwitch} accessibilityRole="button">
              <Text style={styles.authModeSwitchLabel}>이메일을 잘못 입력했나요? </Text>
              <Text style={styles.authModeSwitchAction}>수정하기</Text>
            </Pressable>
            <Text style={styles.authOtpHint}>번호가 오지 않으면 스팸함을 확인하고, 시간이 끝난 뒤 새 번호를 요청해 주세요.</Text>
            <Text style={styles.authOtpHint}>이메일 인증을 완료해야 앱에 로그인할 수 있어요.</Text>
          </>
        ) : (
          <>
            {authMode === 'sign-up' ? (
              <Field
                label="이름 (선택)"
                value={authName}
                onChangeText={setAuthName}
                placeholder="앱에서 사용할 이름"
                inputRef={authNameInput}
                returnKeyType="next"
                onSubmitEditing={() => authEmailInput.current?.focus()}
                onFocus={() => scrollFocusedInputIntoView(authNameInput.current)}
              />
            ) : null}
            {authMode === 'sign-up' ? (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>이메일</Text>
                <View style={styles.emailComposer}>
                  <TextInput
                    ref={authEmailInput}
                    value={authEmailLocal}
                    onChangeText={(value) => setAuthEmailLocal(value.replace(/[@\s]/g, ''))}
                    placeholder="이메일 아이디"
                    placeholderTextColor={colors.muted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="next"
                    onSubmitEditing={() => authEmailDomain === 'custom'
                      ? authEmailDomainInput.current?.focus()
                      : authPasswordInput.current?.focus()}
                    onFocus={() => scrollFocusedInputIntoView(authEmailInput.current)}
                    style={styles.emailLocalInput}
                    accessibilityLabel="이메일 아이디"
                  />
                  <Text style={styles.emailAtSign}>@</Text>
                  {authEmailDomain === 'custom' ? (
                    <>
                      <TextInput
                        ref={authEmailDomainInput}
                        value={authEmailCustomDomain}
                        onChangeText={(value) => setAuthEmailCustomDomain(value.replace(/[@\s]/g, ''))}
                        placeholder="직접 입력"
                        placeholderTextColor={colors.muted}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="next"
                        onSubmitEditing={() => authPasswordInput.current?.focus()}
                        onFocus={() => scrollFocusedInputIntoView(authEmailDomainInput.current)}
                        style={styles.emailCustomDomainInput}
                        accessibilityLabel="이메일 도메인 직접 입력"
                      />
                      <Pressable
                        onPress={() => { Keyboard.dismiss(); setShowEmailDomainOptions((open) => !open); }}
                        style={styles.emailDomainButton}
                        accessibilityRole="button"
                        accessibilityLabel="이메일 도메인 목록 열기"
                      >
                        <Text style={styles.emailDomainChevron}>{showEmailDomainOptions ? '⌃' : '⌄'}</Text>
                      </Pressable>
                    </>
                  ) : (
                    <Pressable
                      onPress={() => { Keyboard.dismiss(); setShowEmailDomainOptions((open) => !open); }}
                      style={styles.emailDomainButton}
                      accessibilityRole="button"
                      accessibilityLabel={`이메일 도메인 ${authEmailDomain}, 변경하기`}
                    >
                      <Text style={styles.emailDomainText}>{authEmailDomain}</Text>
                      <Text style={styles.emailDomainChevron}>{showEmailDomainOptions ? '⌃' : '⌄'}</Text>
                    </Pressable>
                  )}
                </View>
                {showEmailDomainOptions ? (
                  <View style={styles.emailDomainOptions}>
                    {['gmail.com', 'naver.com', 'daum.net', 'hanmail.net', 'outlook.com', 'custom'].map((domain) => (
                      <Pressable
                        key={domain}
                        onPress={() => {
                          setAuthEmailDomain(domain);
                          setShowEmailDomainOptions(false);
                          // Let the selected domain render first, then continue to the
                          // next field and keep it visible above the keyboard.
                          setTimeout(() => {
                            const nextInput = domain === 'custom'
                              ? authEmailDomainInput.current
                              : authPasswordInput.current;
                            nextInput?.focus();
                            scrollFocusedInputIntoView(nextInput);
                          }, 160);
                        }}
                        style={[styles.emailDomainOption, authEmailDomain === domain && styles.emailDomainOptionSelected]}
                        accessibilityRole="button"
                      >
                        <Text style={[styles.emailDomainOptionText, authEmailDomain === domain && styles.emailDomainOptionTextSelected]}>
                          {domain === 'custom' ? '직접 입력' : `@${domain}`}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : (
              <Field
                label="이메일"
                value={authEmail}
                onChangeText={setAuthEmail}
                placeholder="이메일 주소"
                keyboardType="email-address"
                inputRef={authEmailInput}
                returnKeyType="next"
                onSubmitEditing={() => authPasswordInput.current?.focus()}
                onFocus={() => scrollFocusedInputIntoView(authEmailInput.current)}
              />
            )}
            <Field
              label="비밀번호"
              value={authPassword}
              onChangeText={setAuthPassword}
              placeholder="비밀번호"
              secureTextEntry={!authPasswordVisible}
              inputRef={authPasswordInput}
              returnKeyType={authMode === 'sign-up' ? 'next' : 'done'}
              trailingActionLabel={authPasswordVisible ? '숨기기' : '보기'}
              onTrailingActionPress={() => setAuthPasswordVisible((visible) => !visible)}
              onSubmitEditing={() => authMode === 'sign-up'
                ? authPasswordConfirmationInput.current?.focus()
                : Keyboard.dismiss()}
              onFocus={() => scrollFocusedInputIntoView(authPasswordInput.current)}
            />
            {authMode === 'sign-up' ? (
              <>
                <View style={[styles.passwordRequirements, styles.compactPasswordRequirements]}>
                  {getSignupPasswordRequirements(authPassword).map((requirement) => (
                    <View key={requirement.id} style={styles.passwordRequirementRow}>
                      <Text style={[styles.passwordRequirementMark, requirement.met && styles.passwordRequirementMet]}>
                        {requirement.met ? '✓' : '○'}
                      </Text>
                      <Text style={[styles.passwordRequirementText, requirement.met && styles.passwordRequirementMet]}>
                        {requirement.label}
                      </Text>
                    </View>
                  ))}
                </View>
                <Field
                  label="비밀번호 확인"
                  value={authPasswordConfirmation}
                  onChangeText={setAuthPasswordConfirmation}
                  placeholder="비밀번호를 한 번 더 입력해 주세요"
                  secureTextEntry={!authPasswordConfirmationVisible}
                  inputRef={authPasswordConfirmationInput}
                  returnKeyType="done"
                  trailingActionLabel={authPasswordConfirmationVisible ? '숨기기' : '보기'}
                  onTrailingActionPress={() => setAuthPasswordConfirmationVisible((visible) => !visible)}
                  onSubmitEditing={() => { void submitEmailAuth(); }}
                  onFocus={() => scrollFocusedInputIntoView(authPasswordConfirmationInput.current)}
                />
                {authPasswordConfirmation.length > 0 ? (
                  <Text style={[styles.passwordMatchHint, authPassword === authPasswordConfirmation && styles.passwordRequirementMet]}>
                    {authPassword === authPasswordConfirmation ? '비밀번호가 일치해요.' : '비밀번호가 서로 달라요.'}
                  </Text>
                ) : null}
              </>
            ) : null}
            <PrimaryButton
              title={authBusy ? '처리 중…' : authMode === 'sign-up' ? '회원가입' : '로그인'}
              onPress={() => { void submitEmailAuth(); }}
            />
            <Pressable
              onPress={() => {
                setAuthMode((mode) => mode === 'sign-in' ? 'sign-up' : 'sign-in');
                setShowEmailDomainOptions(false);
                setAuthPassword('');
                setAuthPasswordConfirmation('');
                setAuthMessage('');
              }}
              style={styles.authModeSwitch}
              accessibilityRole="button"
            >
              <Text style={styles.authModeSwitchLabel}>{authMode === 'sign-up' ? '이미 계정이 있나요? ' : '처음 오셨나요? '}</Text>
              <Text style={styles.authModeSwitchAction}>{authMode === 'sign-up' ? '로그인' : '회원가입'}</Text>
            </Pressable>
            <View style={styles.authDivider}>
              <View style={styles.authDividerLine} />
              <Text style={styles.authDividerLabel}>간편 로그인</Text>
              <View style={styles.authDividerLine} />
            </View>
            <View style={styles.socialButtonRow}>
              <Pressable
                onPress={() => { void signInWithSocial('kakao'); }}
                disabled={authBusy}
                style={[styles.socialButton, styles.kakaoButton, authBusy && styles.disabledSocialButton]}
                accessibilityRole="button"
                accessibilityLabel="카카오로 로그인"
              >
                <View style={[styles.socialMark, styles.kakaoMark]}><Text style={styles.kakaoMarkText}>K</Text></View>
                <Text style={styles.socialButtonText}>카카오로 시작하기</Text>
              </Pressable>
              <Pressable
                onPress={() => { void signInWithSocial('google'); }}
                disabled={authBusy}
                style={[styles.socialButton, styles.googleButton, authBusy && styles.disabledSocialButton]}
                accessibilityRole="button"
                accessibilityLabel="Google로 로그인"
              >
                <View style={[styles.socialMark, styles.googleMark]}><Text style={styles.googleMarkText}>G</Text></View>
                <Text style={styles.socialButtonText}>Google로 시작하기</Text>
              </Pressable>
            </View>
          </>
        )
      )}
      {authBusy ? <ActivityIndicator color={colors.primary} style={styles.authSpinner} /> : null}
      {authMessage ? <Text style={styles.authMessage} accessibilityRole="alert">{authMessage}</Text> : null}
    </>
  );

  const openTab = (tab: PrimaryTab) => {
    Keyboard.dismiss();
    if (tab === 'friends') setFriendSection('friends');
    setActiveTab(tab);
    setScreen(tab);
  };

  const startCreateGroup = () => {
    setGroupName('');
    setMemberNames([]);
    setMemberNameDraft('');
    setSelectedGroupFriendIds([]);
    setGroupMemberAccounts({});
    setScreen('create-group');
  };

  const addMember = () => {
    const name = memberNameDraft.trim();
    if (!name) return;
    const normalizedName = name.toLocaleLowerCase();
    if (normalizedName === ownerNickname.trim().toLocaleLowerCase()
      || memberNames.some((memberName) => memberName.trim().toLocaleLowerCase() === normalizedName)) {
      Alert.alert('이미 추가한 멤버예요.');
      return;
    }
    setMemberNames((current) => [...current, name]);
    setMemberNameDraft('');
  };

  const toggleGroupFriendSelection = (friendId: string) => {
    Keyboard.dismiss();
    setSelectedGroupFriendIds((current) => current.includes(friendId)
      ? current.filter((id) => id !== friendId)
      : [...current, friendId]);
  };

  const addSelectedGroupFriends = () => {
    const selectedFriends = (socialData?.friends ?? []).filter((friend) => selectedGroupFriendIds.includes(friend.user_id));
    if (selectedFriends.length === 0) return;
    const { added, skipped } = mergeSelectedFriendNames(ownerNickname, memberNames, selectedFriends.map((friend) => friend.nickname));
    if (added.length > 0) setMemberNames((current) => [...current, ...added]);
    if (added.length > 0) {
      const addedNames = new Set(added.map((name) => name.toLocaleLowerCase()));
      setGroupMemberAccounts((current) => ({
        ...current,
        ...Object.fromEntries(selectedFriends
          .filter((friend) => addedNames.has(friend.nickname.trim().toLocaleLowerCase()))
          .map((friend) => [friend.nickname.trim(), friend.user_id])),
      }));
    }
    setSelectedGroupFriendIds([]);
    if (skipped.length > 0) Alert.alert('이미 추가한 친구는 건너뛰었어요.', `${skipped.length}명은 모임에 이미 있어요.`);
  };

  const createGroup = async () => {
    if (groupCreateOperation.current) return;
    Keyboard.dismiss();
    if (!groupName.trim()) return Alert.alert('모임 이름을 입력해 주세요.');
    let groupMemberNames: string[];
    try {
      groupMemberNames = buildGroupMemberNames(ownerNickname, memberNames);
    } catch (error) {
      return Alert.alert(error instanceof Error ? error.message : '멤버 이름을 확인해 주세요.');
    }

    const newGroup: Group = {
      id: makeId(),
      name: groupName.trim(),
      members: groupMemberNames.map((name) => ({ id: makeId(), name })),
      trips: [],
    };
    const friendInvites = buildRemoteFriendInvites(newGroup.members, groupMemberAccounts);
    if (!supabase || !authUser?.id) {
      Alert.alert('모임을 저장하지 못했어요', '로그인 연결을 확인한 뒤 다시 시도해 주세요. 모임은 아직 생성되지 않았습니다.');
      return;
    }
    groupCreateOperation.current = true;
    setGroupCreating(true);
    try {
      await saveRemoteGroup(supabase, newGroup, friendInvites);
      setGroups((current) => [newGroup, ...current]);
      setSelectedGroupId(newGroup.id);
      setScreen('group');
    } catch (error) {
      Alert.alert('모임을 저장하지 못했어요', error instanceof Error ? error.message : '네트워크 연결을 확인한 뒤 다시 시도해 주세요.');
    } finally {
      groupCreateOperation.current = false;
      setGroupCreating(false);
    }
  };

  const acceptGroupInvitation = async (invitation: RemoteGroupInvitation) => {
    if (!supabase || acceptingInvitationId) return;
    setAcceptingInvitationId(invitation.invitationId);
    try {
      const accepted = await acceptRemoteGroupInvitation(supabase, invitation.invitationId);
      if (accepted.status !== 'accepted') throw new Error('초대를 수락하지 못했어요. 다시 시도해 주세요.');
      const invitationNotification = groupNotifications.find((notification) =>
        notification.type === 'group_invitation' && notification.invitationId === accepted.invitationId,
      );
      if (invitationNotification && !invitationNotification.readAt) {
        await markGroupNotificationAsRead(invitationNotification.id);
      }
      const refreshResult = await refreshRemoteGroupData(authUser!.id);
      await refreshGroupNotifications();
      if (!refreshResult.groupsLoaded) {
        Alert.alert('초대를 수락했어요', '모임 목록을 새로고침하지 못했어요. 모임 화면에서 다시 시도해 주세요.');
      }
    } catch (error) {
      Alert.alert('초대를 수락하지 못했어요', error instanceof Error ? error.message : '네트워크 연결을 확인한 뒤 다시 시도해 주세요.');
    } finally {
      setAcceptingInvitationId(null);
    }
  };

  const openGroup = (groupId: string) => {
    setSelectedGroupId(groupId);
    setSelectedTripId(null);
    setScreen('group');
  };

  const deleteGroup = async () => {
    if (!supabase || !group || groupActionBusy) return;
    setGroupActionBusy(true);
    try {
      await deleteRemoteGroup(supabase, group.id);
      setGroups((current) => current.filter((item) => item.id !== group.id));
      setRemoteMemberStatuses((current) => { const next = { ...current }; delete next[group.id]; return next; });
      setSelectedGroupId(null);
      setScreen('groups');
      Alert.alert('모임을 삭제했어요.');
    } catch (error) {
      const code = (error as { code?: string })?.code;
      Alert.alert('모임을 삭제하지 못했어요.', code === 'group_not_found_or_not_owner' ? '삭제 권한이 없거나 이미 삭제된 모임이에요.' : '네트워크를 확인한 뒤 다시 시도해 주세요.');
    } finally {
      setGroupActionBusy(false);
    }
  };

  const requestDeleteTrip = () => {
    if (!group || !trip) return;
    if (!supabase || !authUser?.id || remoteGroupSnapshotState !== 'ready' || !remoteGroupDbIds[group.id] || !isGroupOwner || !isAccountMember) {
      Alert.alert('여행을 삭제할 수 없어요', '최신 모임 권한을 확인하지 못했어요. 모임 정보를 새로고침한 뒤 다시 시도해 주세요.');
      return;
    }
    if (trip.settledAt) {
      Alert.alert('정산이 완료된 여행은 삭제할 수 없어요', '정산 기록을 보존하기 위해 이 여행을 삭제할 수 없어요.');
      return;
    }
    if (trip.expenses.length > 0) {
      Alert.alert('지출이 있는 여행은 삭제할 수 없어요', '기존 지출 기록을 잃지 않도록 지출이 남아 있는 여행은 삭제할 수 없어요.');
      return;
    }

    const targetGroupId = group.id;
    const targetGroupDbId = remoteGroupDbIds[group.id];
    const targetTripId = trip.id;
    Alert.alert('이 여행을 삭제할까요?', '현재 여행 하나만 삭제돼요. 모임과 다른 여행은 삭제되지 않아요.', [
      { text: '취소', style: 'cancel' },
      {
        text: '여행 삭제',
        style: 'destructive',
        onPress: () => { void confirmDeleteTrip(targetGroupId, targetGroupDbId, targetTripId); },
      },
    ]);
  };

  const confirmDeleteTrip = async (groupId: string, groupDbId: string, tripId: string) => {
    if (!supabase || !authUser?.id || tripDeleteBusy || remoteGroupSnapshotState !== 'ready' || !isGroupOwner || !isAccountMember || remoteGroupDbIds[groupId] !== groupDbId) {
      Alert.alert('여행을 삭제할 수 없어요', '모임장 권한이나 최신 모임 정보를 확인하지 못했어요.');
      return;
    }
    setTripDeleteBusy(true);
    try {
      await deleteRemoteGroupTrip(supabase, groupDbId, tripId);
    } catch (error) {
      const code = error instanceof RemoteGroupApiError ? error.code : '';
      const message = code === 'group_trip_has_expenses'
        ? '지출 기록이 남아 있어 여행을 삭제하지 않았어요. 기존 지출을 보존하기 위해 삭제가 차단됐어요.'
        : code === 'group_trip_already_settled'
          ? '정산이 완료된 여행은 기록을 보존하기 위해 삭제할 수 없어요.'
          : code === 'group_trip_expenses_unverifiable'
            ? '서버에서 지출 기록을 확인하지 못해 여행을 삭제하지 않았어요. 잠시 후 다시 시도해 주세요.'
            : code === 'group_trip_not_found_or_forbidden'
              ? '여행을 찾을 수 없거나 모임장 권한이 확인되지 않아 삭제하지 않았어요.'
              : '서버가 여행 삭제를 확인하지 않았어요. 서버 오류나 필요한 DB 업데이트 상태를 확인한 뒤 다시 시도해 주세요.';
      Alert.alert('여행을 삭제하지 못했어요', message);
      setTripDeleteBusy(false);
      return;
    }

    try {
      const snapshot = await loadRemoteGroups(supabase);
      if (activeNotificationUser.current !== authUser.id) {
        Alert.alert('최신 여행 정보를 확인할 수 없어요', '계정 상태가 바뀌어 새 모임 정보를 적용하지 못했어요. 모임 목록에서 다시 확인해 주세요.');
        return;
      }
      setRemoteGroupSnapshotState('ready');
      setRemoteMemberStatuses(Object.fromEntries(snapshot.map((item) => [item.group.id, item.memberStatuses])));
      setRemoteMemberAccounts(Object.fromEntries(snapshot.map((item) => [item.group.id, item.memberAccounts])));
      setRemoteGroupDbIds(Object.fromEntries(snapshot.map((item) => [item.group.id, item.groupDbId ?? ''])));
      const latestGroups = [...new Map(snapshot.map((item) => [item.group.id, item.group])).values()];
      const remoteIds = new Set(latestGroups.map((item) => item.id));
      const deletedIds = new Set(deletedGroupIds);
      setGroups((current) => [
        ...latestGroups.filter((item) => !deletedIds.has(item.id)),
        ...current.filter((item) => !remoteIds.has(item.id) && !deletedIds.has(item.id) && item.id !== groupId),
      ]);

      const canonicalGroup = latestGroups.find((item) => item.id === groupId);
      if (!canonicalGroup || canonicalGroup.trips.some((item) => item.id === tripId)) {
        if (!canonicalGroup) {
          setSelectedTripId(null);
          setSelectedGroupId(null);
          setScreen('groups');
        }
        Alert.alert('여행 삭제 상태를 확인하지 못했어요', '서버 snapshot에서 해당 모임과 여행 삭제를 확인하지 못했어요. 모임 목록을 새로고침한 뒤 상태를 다시 확인해 주세요.');
        return;
      }
      setSelectedTripId(null);
      if (canonicalGroup) {
        setScreen('group');
      } else {
        setSelectedGroupId(null);
        setScreen('groups');
      }
    } catch {
      setRemoteGroupSnapshotState('error');
      Alert.alert('최신 여행 정보를 불러오지 못했어요', '삭제 요청 뒤 서버 응답은 받았지만 최신 모임 snapshot을 확인하지 못했어요. 새 여행을 만들거나 삭제를 다시 요청하기 전에 모임 목록을 새로고침해 주세요.');
    } finally {
      setTripDeleteBusy(false);
    }
  };

  const leaveGroup = async () => {
    if (!supabase || !group || groupActionBusy) return;
    setGroupActionBusy(true);
    try {
      await leaveRemoteGroup(supabase, group.id);
      setGroups((current) => current.filter((item) => item.id !== group.id));
      setSelectedGroupId(null);
      setScreen('groups');
      Alert.alert('모임에서 나왔어요.');
    } catch (error) {
      const code = (error as { code?: string })?.code;
      Alert.alert('모임에서 나가지 못했어요.', code === 'active_group_member_not_found' ? '이미 모임에서 나갔거나 멤버가 아니에요.' : '네트워크를 확인한 뒤 다시 시도해 주세요.');
    } finally {
      setGroupActionBusy(false);
    }
  };

  const startEditGroup = () => {
    if (!group) return;
    Keyboard.dismiss();
    setEditGroupName(group.name);
    setEditMembers(group.members.map((member) => ({ ...member })));
    setEditMemberDraft('');
    setSelectedEditFriendIds([]);
    setScreen('edit-group');
  };

  const addEditMember = () => {
    const name = editMemberDraft.trim();
    if (!name) return;
    if (editMembers.some((member) => member.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
      Alert.alert('이미 추가한 멤버예요.');
      return;
    }
    setEditMembers((current) => [...current, { id: makeId(), name }]);
    setEditMemberDraft('');
  };

  const addSelectedEditFriends = () => {
    const selectedNames = (socialData?.friends ?? [])
      .filter((friend) => selectedEditFriendIds.includes(friend.user_id))
      .map((friend) => friend.nickname);
    const { added, skipped } = mergeSelectedFriendNames(
      editMembers[0]?.name ?? '', editMembers.slice(1).map((member) => member.name), selectedNames,
    );
    if (added.length > 0) setEditMembers((current) => [...current, ...added.map((name) => ({ id: makeId(), name }))]);
    setSelectedEditFriendIds([]);
    if (skipped.length > 0) Alert.alert('이미 추가한 친구는 건너뛰었어요.', `${skipped.length}명은 모임에 이미 있어요.`);
  };

  const removeEditMember = (memberId: string) => {
    if (!group) return;
    const error = getMemberRemovalError(group, memberId);
    if (error) return Alert.alert('멤버를 삭제할 수 없어요', error);
    setEditMembers((current) => current.filter((member) => member.id !== memberId));
  };

  const saveGroupEdits = () => {
    if (!group) return;
    Keyboard.dismiss();
    let updated: Group;
    try {
      updated = applyGroupEdits(group, editGroupName, editMembers);
    } catch (error) {
      return Alert.alert(error instanceof Error ? error.message : '모임 정보를 확인해 주세요.');
    }
    setGroups((current) => current.map((item) => item.id === updated.id ? updated : item));
    setScreen('group');
  };

  const confirmDeleteGroup = () => {
    if (!group || !authUser?.id) return;
    const target = group;
    Alert.alert(
      '모임을 삭제할까요?',
      `‘${target.name}’ 모임과 이 기기에 저장된 여행·지출·사진·정산 기록을 삭제합니다. 이 작업은 되돌릴 수 없어요. 다른 기기나 참여자의 데이터는 삭제되지 않습니다.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '모임 삭제',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                const nextDeletedIds = [...new Set([...deletedGroupIds, target.id])];
                await createAccountGroupStore(authUser.id).saveDeletedGroupIds(nextDeletedIds);
                setDeletedGroupIds(nextDeletedIds);
                setGroups((current) => current.filter((item) => item.id !== target.id));
                setSelectedGroupId(null);
                setSelectedTripId(null);
                setScreen('groups');
              } catch {
                Alert.alert('모임을 삭제하지 못했어요', '저장 공간을 확인한 뒤 다시 시도해 주세요. 모임은 삭제되지 않았습니다.');
              }
            })();
          },
        },
      ],
    );
  };

  const openTrip = (groupId: string, tripId: string, destination: 'trip' | 'settlement' = 'trip') => {
    setSelectedGroupId(groupId);
    setSelectedTripId(tripId);
    if (destination === 'settlement') setSettlementReturnScreen('settlements');
    setScreen(destination);
  };

  const saveTripPhase = (phase: 'end' | 'reopen') => {
    if (!group || !trip) return;
    const now = new Date().toISOString();
    setGroups((current) => current.map((item) => item.id !== group.id ? item : {
      ...item,
      trips: item.trips.map((existingTrip) => existingTrip.id !== trip.id ? existingTrip : {
        ...existingTrip,
        ...(phase === 'end' ? { endedAt: now } : {}),
        ...(phase === 'reopen' ? { endedAt: undefined } : {}),
      }),
    }));
  };

  const changeTripPhase = () => {
    if (!trip) return;
    const phase = getTripPhase(trip);
    if (phase === 'planned') return;
    const action = phase === 'inProgress' ? 'end' : 'reopen';
    const title = action === 'end' ? '여행을 종료할까요?' : '여행을 다시 열까요?';
    const message = action === 'end'
      ? '여행을 종료해도 지출과 사진은 계속 확인할 수 있어요. 정산은 별도로 완료 처리해 주세요.'
      : action === 'reopen' ? '종료 표시를 해제하고 여행 중 상태로 바꿉니다.' : '시작 시각을 기록하고 여행 중으로 표시합니다.';
    Alert.alert(title, message, [
      { text: '취소', style: 'cancel' },
      { text: action === 'end' ? '여행 종료' : '다시 열기', onPress: () => saveTripPhase(action) },
    ]);
  };

  const saveTripPhotos = (updatePhotos: (current: TripPhoto[]) => TripPhoto[]) => {
    if (!group || !trip) return;
    setGroups((current) => current.map((item) => item.id !== group.id ? item : {
      ...item,
      trips: item.trips.map((existingTrip) => existingTrip.id !== trip.id ? existingTrip : { ...existingTrip, photos: updatePhotos(existingTrip.photos ?? []) }),
    }));
  };

  const canSyncSelectedTrip = () => Boolean(
    supabase && authStatus === 'signed-in' && authUser?.id && group && trip
      && isAccountMember && remoteGroupDbIds[group.id],
  );

  const retryTripSync = async () => {
    if (!supabase || !group || !trip || !remoteGroupDbIds[group.id]) return;
    setTripSyncLoadingFor(group.id, trip.id, true);
    try {
      const snapshot = await loadRemoteTripSync(supabase, remoteGroupDbIds[group.id], trip.id);
      await applyTripSyncSnapshot(snapshot, group.id, trip.id, remoteGroupDbIds[group.id]);
    } catch (error) {
      setTripSyncMessage(tripSyncFailureMessage(error, '다른 기기와 동기화하지 못했어요.'));
    } finally {
      setTripSyncLoadingFor(group.id, trip.id, false);
    }
  };

  const handleTripPhotosAdded = async (photos: TripPhoto[]) => {
    if (!photos.length || !canSyncSelectedTrip() || !group || !trip || !supabase || !authUser) return;
    const dbId = remoteGroupDbIds[group.id];
    const key = `${group.id}:${trip.id}`;
    let firstAdded: import('./src/data/remoteTripSync').RemotePhoto | undefined;
    let remotelyAddedCount = 0;
    try {
      for (const photo of photos) {
        const bytes = await new File(photo.uri).bytes();
        const extension = photo.uri.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1]?.toLowerCase();
        const mimeType = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
        const metadata: RemotePhotoInput & { bytes: Uint8Array } = {
          ...photo,
          storageKey: `${dbId}/${trip.id}/${photo.id}`,
          mimeType,
          sizeBytes: bytes.byteLength,
          bytes,
        };
        const result = await uploadRemoteTripPhoto(supabase, dbId, trip.id, metadata);
        const saved = result.entity;
        if (saved) remotelyAddedCount += 1;
        if (!saved) throw new Error('사진 등록 결과가 비어 있어요.');
        if (!firstAdded) firstAdded = saved;
        setGroups((current) => current.map((item) => item.id !== group.id ? item : {
          ...item,
          trips: item.trips.map((existingTrip) => existingTrip.id !== trip.id ? existingTrip : {
            ...existingTrip,
            photos: (existingTrip.photos ?? []).map((existingPhoto) => existingPhoto.id === saved.id ? { ...saved, uri: existingPhoto.uri } : existingPhoto),
          }),
        }));
      }
      if (firstAdded && !trip.coverPhotoId) {
        const expectedCoverVersion = tripSyncVersions.current.get(key)?.coverVersion ?? 0;
        const result = await setRemoteTripCover(supabase, dbId, trip.id, firstAdded, expectedCoverVersion);
        tripSyncVersions.current.set(key, {
          coverVersion: result.entityVersion,
          settlementVersion: tripSyncVersions.current.get(key)?.settlementVersion ?? 0,
        });
        setGroups((current) => current.map((item) => item.id !== group.id ? item : {
          ...item,
          trips: item.trips.map((existingTrip) => existingTrip.id === trip.id ? { ...existingTrip, coverPhotoId: firstAdded!.id } : existingTrip),
        }));
      }
      setTripSyncMessage('');
    } catch (error) {
      const message = tripSyncFailureMessage(error, '이 기기에는 저장했지만 모임에 공유하지 못했어요.', {
        succeeded: remotelyAddedCount, total: photos.length,
      });
      setTripSyncMessage(message);
      Alert.alert('사진 동기화 실패', message);
    }
  };

  const handleTripPhotoRemoved = async (photo: TripPhoto) => {
    if (!canSyncSelectedTrip() || !group || !trip || !supabase) return;
    if (photo.version === undefined) {
      setTripSyncMessage('이 사진은 이 기기에만 저장되어 있어 다른 기기와 공유되지 않았어요.');
      return;
    }
    try {
      const result = await deleteRemoteTripPhoto(supabase, remoteGroupDbIds[group.id], trip.id, photo.id, photo.version);
      const key = `${group.id}:${trip.id}`;
      const versions = tripSyncVersions.current.get(key);
      tripSyncVersions.current.set(key, {
        coverVersion: result.coverVersion ?? versions?.coverVersion ?? 0,
        settlementVersion: versions?.settlementVersion ?? 0,
      });
      if (!result.storageObjectDeleted) setTripSyncMessage(tripSyncFailureMessage(result.storageCleanupError, '사진은 모임에서 삭제했지만 서버 파일 정리가 완료되지 않았어요.'));
      else setTripSyncMessage('');
      return true;
    } catch (error) {
      setTripSyncMessage(tripSyncFailureMessage(error, '사진을 다른 기기와 동기화하지 못했어요.'));
      Alert.alert('사진 삭제 동기화 실패', '모임 서버에서 사진을 삭제하지 못해 여행 목록에 그대로 두었어요. 연결을 확인한 뒤 다시 시도해 주세요.');
      return false;
    }
  };

  const saveTripCoverPhoto = async (coverPhotoId?: string) => {
    if (!group || !trip) return;
    setGroups((current) => current.map((item) => item.id !== group.id ? item : {
      ...item,
      trips: item.trips.map((existingTrip) => existingTrip.id !== trip.id ? existingTrip : { ...existingTrip, coverPhotoId }),
    }));
    if (!coverPhotoId || !canSyncSelectedTrip() || !supabase) return;
    const photo = trip.photos?.find((item) => item.id === coverPhotoId);
    if (!photo?.storageKey || photo.version === undefined) {
      setTripSyncMessage('대표 사진은 이 기기에만 저장되어 있어 모임과 동기화되지 않았어요.');
      Alert.alert('대표 사진 동기화 실패', '이 기기에만 저장된 사진은 다른 기기의 대표 사진으로 설정할 수 없어요.');
      return;
    }
    const key = `${group.id}:${trip.id}`;
    try {
      const result = await setRemoteTripCover(supabase, remoteGroupDbIds[group.id], trip.id, photo as import('./src/data/remoteTripSync').RemotePhoto,
        tripSyncVersions.current.get(key)?.coverVersion ?? 0);
      tripSyncVersions.current.set(key, {
        coverVersion: result.entityVersion,
        settlementVersion: tripSyncVersions.current.get(key)?.settlementVersion ?? 0,
      });
      setTripSyncMessage('');
    } catch (error) {
      setTripSyncMessage(tripSyncFailureMessage(error, '대표 사진을 공유하지 못했어요.'));
      Alert.alert('대표 사진 동기화 실패', '대표 사진이 이 기기에서만 바뀌었어요. 모임에 공유하지 못했습니다.');
    }
  };

  const startCreateTrip = () => {
    if (!group) return;
    if (authStatus !== 'signed-in' || !authUser?.id || !supabase) {
      Alert.alert('계정 연결이 필요해요', '다른 계정의 모임에 여행을 공유하고 앱 알림을 보내려면 먼저 로그인해 주세요. 로그인하지 않은 상태에서는 이 모임과 계정 간 동기화를 할 수 없어요.');
      return;
    }
    if (remoteGroupSnapshotState !== 'ready') {
      Alert.alert('모임 회원 정보를 확인할 수 없어요', '연결 상태를 확인한 뒤 다시 시도해 주세요. 아직 계정 간 여행 공유가 확인되지 않았어요.');
      return;
    }
    if (!isAccountMember) {
      const memberStatus = currentMemberId ? remoteMemberStatuses[group.id]?.[currentMemberId] : undefined;
      Alert.alert(
        memberStatus === 'pending' || memberStatus === 'removed' ? '활성 모임 계정이 아니에요' : '계정에 연결된 모임 회원이 아니에요',
        memberStatus === 'pending' || memberStatus === 'removed'
          ? '초대를 수락해 활성 회원이 된 뒤 여행을 만들 수 있어요.'
          : '이름만 등록된 게스트는 다른 계정과 여행을 동기화하거나 알림을 받을 수 없어요. 이 계정으로 모임 초대를 수락해 활성 회원이 되어 주세요.',
      );
      return;
    }
    if (!remoteGroupDbIds[group.id]) {
      Alert.alert('모임 정보를 새로 확인해 주세요', '여행 공유에 필요한 서버 모임 정보를 아직 받지 못했어요. 최신 앱과 서버 연결을 확인한 뒤 다시 시도해 주세요.');
      return;
    }
    setTripName('');
    setDestination('');
    setDetailAddress('');
    setTripStartDate(null);
    setTripEndDate(null);
    setTreasurerId(group.members[0]?.id ?? '');
    setScreen('create-trip');
  };

  const startEditTrip = () => {
    if (!group || !trip) return;
    if (!isGroupOwner) {
      Alert.alert('모임 소유자만 여행을 수정할 수 있어요', '현재 서버 권한에서는 여행 기록 수정을 모임 소유자에게 요청해야 해요.');
      return;
    }
    const dates = parseTripDateRange(trip.dateRange);
    if (!dates) {
      Alert.alert('여행 날짜를 불러오지 못했어요.', '날짜 형식을 확인한 뒤 다시 시도해 주세요.');
      return;
    }
    setTripName(trip.name);
    setDestination(trip.destination);
    setDetailAddress(trip.detailAddress);
    setTripStartDate(dates.startDate);
    setTripEndDate(dates.endDate);
    setTreasurerId(trip.treasurerId);
    setScreen('edit-trip');
  };

  const saveTrip = async () => {
    Keyboard.dismiss();
    if (!group) return;
    if (!tripName.trim() || !destination.trim() || !tripStartDate || !tripEndDate || !treasurerId) {
      return Alert.alert('여행 이름, 장소, 날짜, 회계를 모두 입력해 주세요.');
    }
    if (tripStartDate > tripEndDate) return Alert.alert('여행 종료일은 시작일보다 빠를 수 없어요.');
    const details = {
      name: tripName.trim(),
      destination: destination.trim(),
      detailAddress: detailAddress.trim(),
      dateRange: formatDateRange(tripStartDate, tripEndDate),
      treasurerId,
    };

    let savedTrip: Trip;
    if (screen === 'edit-trip') {
      if (!isGroupOwner || !supabase) {
        Alert.alert('여행을 수정할 수 없어요', '여행 수정은 모임 소유자 계정에서 할 수 있어요.');
        return;
      }
      if (!trip) return Alert.alert('여행 정보를 찾을 수 없어요.');
      savedTrip = withUpdatedTripDetails(trip, details);
    } else {
      if (authStatus !== 'signed-in' || !authUser?.id || !supabase) {
        Alert.alert('계정 연결이 필요해요', '다른 계정의 모임에 여행을 공유하고 앱 알림을 보내려면 먼저 로그인해 주세요. 로그인하지 않은 상태에서는 이 모임과 계정 간 동기화를 할 수 없어요.');
        return;
      }
      if (remoteGroupSnapshotState !== 'ready' || !isAccountMember) {
        Alert.alert('활성 모임 계정이 필요해요', '모임의 활성 회원 정보가 확인되지 않았어요. 초대를 수락한 계정으로 로그인한 뒤 다시 시도해 주세요. 이름만 등록된 게스트는 계정 간 동기화 대상이 아니에요.');
        return;
      }
      if (!remoteGroupDbIds[group.id]) {
        Alert.alert('모임 정보를 새로 확인해 주세요', '여행 공유에 필요한 서버 모임 정보를 아직 받지 못했어요. 최신 앱과 서버 연결을 확인한 뒤 다시 시도해 주세요.');
        return;
      }
      savedTrip = { id: makeId(), ...details, expenses: [] };
    }
    setTripSaving(true);
    try {
      if (screen === 'edit-trip') {
        const updatedGroup: Group = {
          ...group,
          trips: group.trips.map((existingTrip) => existingTrip.id === trip!.id ? savedTrip : existingTrip),
        };
        const friendInvites = Object.entries(remoteMemberAccounts[group.id] ?? {})
          .map(([memberId, friendUserId]) => ({ memberId, friendUserId }));
        await saveRemoteGroup(supabase!, updatedGroup, friendInvites);
        setGroups((current) => current.map((item) => item.id === group.id ? updatedGroup : item));
        setSelectedTripId(savedTrip.id);
        setScreen('trip');
      } else {
        await createRemoteGroupTrip(supabase!, remoteGroupDbIds[group.id], savedTrip);
        const refreshed = await refreshRemoteGroupData(authUser!.id);
        const canonicalGroup = refreshed.remoteGroups?.find((item) => item.group.id === group.id)?.group;
        const canonicalTrip = canonicalGroup?.trips.find((item) => item.id === savedTrip.id);
        if (!refreshed.groupsLoaded || !canonicalGroup || !canonicalTrip) {
          Alert.alert('여행 요청을 보냈어요', '서버 저장 결과를 화면에 다시 불러오지 못했어요. 새 여행을 다시 만들지 말고 모임 화면의 다시 시도를 눌러 최신 목록을 확인해 주세요.');
          return;
        }
        setSelectedTripId(canonicalTrip.id);
        setScreen('trip');
      }
    } catch (error) {
      const code = error instanceof RemoteGroupApiError ? error.code : '';
      const message = code === 'authentication_required'
        ? '로그인 세션을 확인할 수 없어요. 다시 로그인해 주세요.'
        : code === 'group_trip_not_found_or_not_member'
          ? '이 모임의 활성 계정 회원만 여행을 만들 수 있어요. 초대를 수락했는지 확인해 주세요.'
          : code === 'group_trip_id_conflict'
            ? '여행 요청 ID가 이미 사용 중이에요. 화면을 새로고침한 뒤 다시 시도해 주세요.'
            : error instanceof Error ? error.message : '네트워크 연결을 확인하고 다시 시도해 주세요.';
      Alert.alert('여행을 저장하지 못했어요', message);
    } finally {
      setTripSaving(false);
    }
  };

  const startAddExpense = () => {
    if (!group) return;
    if (trip?.settledAt) {
      Alert.alert('정산이 완료된 여행이에요.', '지출을 추가하려면 정산 결과에서 다시 열어 주세요.');
      return;
    }
    const firstMember = group.members[0]?.id ?? '';
    setExpenseTitle('');
    setExpenseAmount('');
    setPayerId(firstMember);
    setParticipantIds(group.members.map((member) => member.id));
    setEditingExpenseId(null);
    setScreen('add-expense');
  };

  const startEditExpense = (expense: Expense) => {
    if (trip?.settledAt) {
      Alert.alert('정산 완료된 여행이에요.', '지출을 수정하려면 정산 결과에서 다시 열어 주세요.');
      return;
    }
    setEditingExpenseId(expense.id);
    setExpenseTitle(expense.title);
    setExpenseAmount(String(expense.amount));
    setPayerId(expense.payerId);
    setParticipantIds([...expense.participantIds]);
    setScreen('edit-expense');
  };

  const saveExpense = async () => {
    Keyboard.dismiss();
    if (!group || !trip) return;
    if (trip.settledAt) {
      Alert.alert('정산이 완료된 여행이에요.', '지출을 수정하려면 정산 결과에서 다시 열어 주세요.');
      return;
    }
    const amount = Number(expenseAmount);
    if (!expenseTitle.trim() || !Number.isSafeInteger(amount) || amount <= 0) {
      return Alert.alert('내역과 1원 이상의 금액을 입력해 주세요.');
    }
    if (!payerId || participantIds.length === 0) {
      return Alert.alert('결제자와 비용을 나눌 멤버를 선택해 주세요.');
    }

    if (screen === 'edit-expense' && !editingExpenseId) {
      Alert.alert('수정할 지출을 찾지 못했어요.');
      return;
    }
    const expenseDetails = {
      id: screen === 'edit-expense' ? editingExpenseId! : makeId(),
      title: expenseTitle.trim(),
      amount,
      payerId,
      participantIds: [...participantIds],
    };
    const expense: Expense = screen === 'edit-expense'
      ? {
        ...expenseDetails,
        createdByUserId: trip.expenses.find((item) => item.id === editingExpenseId)?.createdByUserId,
        version: trip.expenses.find((item) => item.id === editingExpenseId)?.version,
      }
      : createExpense(expenseDetails, authUser?.id);
    const nextGroups = groups.map((item) => item.id !== group.id ? item : {
      ...item,
      trips: item.trips.map((existingTrip) => existingTrip.id !== trip.id ? existingTrip : {
        ...(screen === 'edit-expense'
          ? replaceTripExpense(existingTrip, expense)
          : { ...existingTrip, expenses: [expense, ...existingTrip.expenses] }),
      }),
    });
    setScreen('trip');
    if (!canSyncSelectedTrip() || !supabase) {
      setGroups(nextGroups);
      return;
    }
    const tripKey = `${group.id}:${trip.id}`;
    const operationKey = `${tripKey}:expense:${expense.id}`;
    const operationId = startTripSyncOperation(operationKey);
    const statusGeneration = tripSyncStatusGenerations.current.begin(tripKey);
    const revisionAtStart = tripSyncRevisions.current.get(tripKey) ?? -1;
    const previousExpense = trip.expenses.find((item) => item.id === expense.id);
    let localSaved = false;
    try {
      await persistTripCommandSnapshot(nextGroups);
      localSaved = true;
      const saved = screen === 'edit-expense'
        ? await (async () => {
          const version = trip.expenses.find((item) => item.id === expense.id)?.version;
          if (version === undefined) throw new Error('이 지출은 공유 서버에 등록된 기록이 아니에요.');
          return updateRemoteExpense(supabase!, remoteGroupDbIds[group.id], trip.id, expense, version);
        })()
        : await createRemoteExpense(supabase, remoteGroupDbIds[group.id], trip.id, expense);
      const latestRevision = tripSyncRevisions.current.get(tripKey) ?? -1;
      if (saved.entity && tripSyncOperations.current.get(operationKey) === operationId && saved.groupRevision >= latestRevision) {
        tripSyncRevisions.current.set(tripKey, saved.groupRevision);
        setGroups((current) => current.map((item) => item.id !== group.id ? item : {
          ...item,
          trips: item.trips.map((existingTrip) => existingTrip.id !== trip.id ? existingTrip : {
            ...existingTrip,
            expenses: existingTrip.expenses.map((itemExpense) => itemExpense.id === saved.entity!.id ? saved.entity! : itemExpense),
          }),
        }));
      }
      const ownsSyncStatus = tripSyncOperations.current.get(operationKey) === operationId;
      finishTripSyncOperation(operationKey, operationId);
      if (ownsSyncStatus && tripSyncStatusGenerations.current.isCurrent(tripKey, statusGeneration)) {
        setTripSyncMessage('');
        setTripSyncOutcomeFor(group.id, trip.id, 'applied', saved.commandId);
      }
    } catch (error) {
      if (localSaved) await recoverFailedTripSyncEntity({ kind: 'expense', groupId: group.id, tripId: trip.id, dbId: remoteGroupDbIds[group.id], expenseId: expense.id, previous: previousExpense, optimistic: expense, operationKey, operationId, revisionAtStart });
      const ownsSyncStatus = tripSyncOperations.current.get(operationKey) === operationId;
      finishTripSyncOperation(operationKey, operationId);
      const status = tripSyncCommandStatusFromError(error, localSaved);
      if (ownsSyncStatus && tripSyncStatusGenerations.current.isCurrent(tripKey, statusGeneration)) setTripSyncOutcomeFor(group.id, trip.id, status.failureStage === 'local_save' ? 'local-save-failed' : status.remoteState === 'rejected' ? 'rejected' : 'unknown', status.commandId);
      if (ownsSyncStatus && tripSyncStatusGenerations.current.isCurrent(tripKey, statusGeneration)) setTripSyncMessage(tripSyncFailureMessage(error, '지출을 다른 기기와 공유하지 못했어요.'));
      Alert.alert('지출 동기화 실패', '이 기기에는 저장했지만 모임에 공유하지 못했어요. 다른 기기에서는 보이지 않을 수 있습니다.');
    }
  };

  const deleteExpense = (expense: Expense) => {
    if (!group || !trip) return;
    if (trip.settledAt) {
      Alert.alert('정산 완료된 여행이에요.', '지출을 삭제하려면 정산 결과에서 다시 열어 주세요.');
      return;
    }
    Alert.alert(
      '지출 내역을 삭제할까요?',
      `${expense.title} · ${money(expense.amount)}을 삭제하면 정산 결과가 다시 계산돼요.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: () => { void (async () => {
            const tripKey = `${group.id}:${trip.id}`;
            const operationKey = `${tripKey}:expense:${expense.id}`;
            const operationId = startTripSyncOperation(operationKey);
            const statusGeneration = tripSyncStatusGenerations.current.begin(tripKey);
            const revisionAtStart = tripSyncRevisions.current.get(tripKey) ?? -1;
            const previousExpense = trip.expenses.find((item) => item.id === expense.id);
            const nextGroups = groups.map((item) => item.id !== group.id ? item : {
              ...item,
              trips: item.trips.map((existingTrip) => existingTrip.id !== trip.id
                ? existingTrip
                : removeTripExpense(existingTrip, expense.id)),
            });
            if (!canSyncSelectedTrip() || !supabase) {
              setGroups(nextGroups);
              finishTripSyncOperation(operationKey, operationId);
              return;
            }
            let localSaved = false;
            try {
              await persistTripCommandSnapshot(nextGroups);
              localSaved = true;
              if (expense.version === undefined) throw new Error('이 지출은 공유 서버에 등록된 기록이 아니에요.');
              const result = await deleteRemoteExpense(supabase, remoteGroupDbIds[group.id], trip.id, expense.id, expense.version);
              const latestRevision = tripSyncRevisions.current.get(tripKey) ?? -1;
              if (tripSyncOperations.current.get(operationKey) === operationId && result.groupRevision >= latestRevision) {
                tripSyncRevisions.current.set(tripKey, result.groupRevision);
              }
              const ownsSyncStatus = tripSyncOperations.current.get(operationKey) === operationId;
              finishTripSyncOperation(operationKey, operationId);
              if (ownsSyncStatus && tripSyncStatusGenerations.current.isCurrent(tripKey, statusGeneration)) {
                setTripSyncMessage('');
                setTripSyncOutcomeFor(group.id, trip.id, 'applied', result.commandId);
              }
            } catch (error) {
              if (localSaved) await recoverFailedTripSyncEntity({ kind: 'expense', groupId: group.id, tripId: trip.id, dbId: remoteGroupDbIds[group.id], expenseId: expense.id, previous: previousExpense, operationKey, operationId, revisionAtStart });
              const ownsSyncStatus = tripSyncOperations.current.get(operationKey) === operationId;
              finishTripSyncOperation(operationKey, operationId);
              const status = tripSyncCommandStatusFromError(error, localSaved);
              if (ownsSyncStatus && tripSyncStatusGenerations.current.isCurrent(tripKey, statusGeneration)) setTripSyncOutcomeFor(group.id, trip.id, status.failureStage === 'local_save' ? 'local-save-failed' : status.remoteState === 'rejected' ? 'rejected' : 'unknown', status.commandId);
              if (ownsSyncStatus && tripSyncStatusGenerations.current.isCurrent(tripKey, statusGeneration)) setTripSyncMessage(tripSyncFailureMessage(error, '지출 삭제를 다른 기기와 동기화하지 못했어요.'));
              Alert.alert('지출 삭제 동기화 실패', '이 기기에서는 삭제했지만 모임 서버의 기록은 삭제하지 못했습니다.');
            }
          })(); } },
      ],
    );
  };

  const updateSettlementStatus = (completed: boolean) => {
    if (!group || !trip) return;
    Alert.alert(
      completed ? '정산을 완료할까요?' : '정산을 다시 열까요?',
      completed
        ? '모든 송금이 끝난 뒤 완료로 표시해 주세요. 완료하면 지출 추가가 잠깁니다.'
        : '정산을 다시 열면 지출을 추가할 수 있고, 정산 결과도 새 지출 기준으로 계산됩니다.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: completed ? '완료 표시' : '다시 열기',
          onPress: () => { void (async () => {
            const key = `${group.id}:${trip.id}`;
            const operationKey = `${key}:settlement`;
            const operationId = startTripSyncOperation(operationKey);
            const statusGeneration = tripSyncStatusGenerations.current.begin(key);
            const revisionAtStart = tripSyncRevisions.current.get(key) ?? -1;
            const previousSettledAt = trip.settledAt;
            const optimisticSettledAt = completed ? new Date().toISOString() : undefined;
            const nextGroups = groups.map((item) => item.id !== group.id ? item : {
              ...item,
              trips: item.trips.map((existingTrip) => existingTrip.id !== trip.id ? existingTrip : {
                ...existingTrip,
                settledAt: optimisticSettledAt,
              }),
            });
            if (!canSyncSelectedTrip() || !supabase) {
              setGroups(nextGroups);
              finishTripSyncOperation(operationKey, operationId);
              return;
            }
            let localSaved = false;
            try {
              await persistTripCommandSnapshot(nextGroups);
              localSaved = true;
              const expectedVersion = tripSyncVersions.current.get(key)?.settlementVersion ?? 0;
              const result = completed
                ? await completeRemoteSettlement(supabase, remoteGroupDbIds[group.id], trip.id, expectedVersion)
                : await reopenRemoteSettlement(supabase, remoteGroupDbIds[group.id], trip.id, expectedVersion);
              const latestRevision = tripSyncRevisions.current.get(key) ?? -1;
              if (tripSyncOperations.current.get(operationKey) === operationId && result.groupRevision >= latestRevision) {
                tripSyncRevisions.current.set(key, result.groupRevision);
                tripSyncVersions.current.set(key, {
                  coverVersion: tripSyncVersions.current.get(key)?.coverVersion ?? 0,
                  settlementVersion: result.entityVersion,
                });
                setGroups((current) => current.map((item) => item.id !== group.id ? item : {
                  ...item,
                  trips: item.trips.map((existingTrip) => existingTrip.id === trip.id ? {
                    ...existingTrip, settledAt: result.entity?.settledAt ?? undefined,
                    syncRevision: Math.max(existingTrip.syncRevision ?? -1, result.groupRevision),
                  } : existingTrip),
                }));
              }
              const ownsSyncStatus = tripSyncOperations.current.get(operationKey) === operationId;
              finishTripSyncOperation(operationKey, operationId);
              if (ownsSyncStatus && tripSyncStatusGenerations.current.isCurrent(key, statusGeneration)) {
                setTripSyncMessage('');
                setTripSyncOutcomeFor(group.id, trip.id, 'applied', result.commandId);
              }
            } catch (error) {
              if (localSaved) await recoverFailedTripSyncEntity({ kind: 'settlement', groupId: group.id, tripId: trip.id, dbId: remoteGroupDbIds[group.id], previous: previousSettledAt, optimistic: optimisticSettledAt, operationKey, operationId, revisionAtStart });
              const ownsSyncStatus = tripSyncOperations.current.get(operationKey) === operationId;
              finishTripSyncOperation(operationKey, operationId);
              const status = tripSyncCommandStatusFromError(error, localSaved);
              if (ownsSyncStatus && tripSyncStatusGenerations.current.isCurrent(key, statusGeneration)) setTripSyncOutcomeFor(group.id, trip.id, status.failureStage === 'local_save' ? 'local-save-failed' : status.remoteState === 'rejected' ? 'rejected' : 'unknown', status.commandId);
              if (ownsSyncStatus && tripSyncStatusGenerations.current.isCurrent(key, statusGeneration)) setTripSyncMessage(tripSyncFailureMessage(error, '정산 상태를 다른 기기와 동기화하지 못했어요.'));
              Alert.alert('정산 동기화 실패', '이 기기에서는 상태를 바꿨지만 모임 서버에 반영하지 못했습니다.');
            }
          })(); } },
      ],
    );
  };

  const addQuickExpenseAmount = (increment: number) => {
    setExpenseAmount((current) => {
      const currentAmount = Number(current) || 0;
      const nextAmount = currentAmount + increment;
      return Number.isSafeInteger(nextAmount) ? String(nextAmount) : current;
    });
  };

  const toggleParticipant = (memberId: string) => {
    setParticipantIds((current) => current.includes(memberId)
      ? current.filter((id) => id !== memberId)
      : [...current, memberId],
    );
  };

  const headerContext = screen === 'home'
    ? '친구들과 함께'
    : screen === 'groups'
      ? '내 모임'
      : screen === 'trips'
        ? '여행 기록'
        : screen === 'map'
          ? '추억 지도'
          : screen === 'settlements'
            ? '여행 정산'
    : screen === 'account'
      ? '내 계정'
    : screen === 'friends'
      ? '친구 관리'
    : screen === 'notifications'
      ? '알림'
    : screen === 'create-group'
      ? '새 모임'
      : screen === 'edit-group'
        ? '모임 수정'
      : screen === 'group' || screen === 'create-trip'
        ? group?.name
        : trip?.name;

  if (authStatus === 'checking') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <View style={styles.storageGate}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.storageGateTitle}>로그인 상태를 확인하고 있어요</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (authStatus !== 'signed-in') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <View style={styles.authGateHeader}><BrandLogo editorial /></View>
        <ScrollView
          ref={contentScroll}
          contentContainerStyle={styles.authGateContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
        >
          <Text style={styles.journalTripNote}>친구와 함께한 여행을 기록하는 곳</Text>
          {renderAuthPanel()}
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (socialState === 'loading') {
    return <SafeAreaView style={styles.safeArea}><StatusBar style="dark" /><View style={styles.storageGate}><ActivityIndicator size="large" color={colors.primary} /><Text style={styles.storageGateTitle}>계정 프로필을 확인하고 있어요</Text></View></SafeAreaView>;
  }

  if (socialState === 'error') {
    return <SafeAreaView style={styles.safeArea}><StatusBar style="dark" /><View style={styles.storageGate}>
      <Text style={styles.storageGateTitle}>계정 설정을 불러오지 못했어요</Text>
      <Text style={styles.storageGateDescription}>친구와 닉네임 기능을 위해 Supabase 프로필 마이그레이션을 적용해야 해요. 오류: {socialError}</Text>
      <Pressable onPress={() => {
        if (!supabase) return;
        setSocialState('loading');
        void loadSocialData(supabase).then((data) => {
          setSocialData(data); setSocialProfile(data.profile); setNicknameDraft(data.profile.nickname ?? getAccountNickname(authUser));
          setNotificationsEnabled(data.profile.notifications_enabled); setSocialState('ready');
        }).catch((error) => { setSocialError(error instanceof Error ? error.message : '프로필을 불러오지 못했어요.'); setSocialState('error'); });
      }} style={styles.primaryButton} accessibilityRole="button"><Text style={styles.primaryButtonText}>다시 시도</Text></Pressable>
      <Pressable onPress={() => { void signOut(); }} style={styles.authModeSwitch}><Text style={styles.authModeSwitchAction}>로그아웃</Text></Pressable>
    </View></SafeAreaView>;
  }

  if (!socialProfile?.nickname && screen !== 'notifications') return renderNicknameSetup();

  if (storageState === 'error') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <View style={styles.storageGate}>
          <Text style={styles.storageGateTitle}>여행 기록을 열지 못했어요</Text>
          <Text style={styles.storageGateDescription}>{storageError}</Text>
          <Pressable onPress={retryStorageLoad} style={styles.primaryButton} accessibilityRole="button">
            <Text style={styles.primaryButtonText}>다시 시도</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (storageState === 'loading' || storageUserId !== authUser?.id) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <View style={styles.storageGate}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.storageGateTitle}>이 계정의 여행 기록을 불러오고 있어요</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (friendIntroVisible && screen !== 'notifications') return renderFriendIntro();


  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        {isPrimaryTab ? (
          <BrandLogo editorial />
        ) : (
          <Pressable onPress={goBack} style={styles.backButton} hitSlop={8} accessibilityRole="button">
            <Text style={styles.backText}>‹</Text>
          </Pressable>
        )}
        {screen === 'home' ? null : (
          <Text style={styles.headerContext} numberOfLines={1}>{headerContext}</Text>
        )}
        <View style={styles.headerActions}>
          {renderBellButton()}
          <Pressable
            onPress={openAccount}
            style={styles.headerAccountButton}
            accessibilityRole="button"
            accessibilityLabel="내 계정"
            accessibilityState={{ selected: screen === 'account' }}
          >
            <View style={styles.headerAvatar}>
              {profilePhotoUri
                ? <Image source={{ uri: profilePhotoUri }} style={styles.headerAvatarImage} />
                : <Text style={styles.headerAvatarText}>{socialProfile?.nickname?.slice(0, 1) ?? '모'}</Text>}
            </View>
          </Pressable>
        </View>
      </View>

      <ScrollView
        ref={contentScroll}
        contentContainerStyle={screen === 'home' ? styles.journalContent : styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
      >
        {storageError ? (
          <View style={styles.storageWarning}>
            <Text style={styles.storageWarningText}>{storageError}</Text>
          </View>
        ) : null}
        {screen === 'account' && renderAccountPanel()}
        {screen === 'notifications' && renderNotificationsPanel()}
        {screen === 'friends' && renderFriendsPanel()}
        {screen === 'home' && (
          <>
            <View style={styles.journalIntro}>
              <Text style={styles.journalHeadline}>
                좋은 여행이에요,{ '\n' }
                <Text style={styles.journalHeadlineAccent}>지금도.</Text>
              </Text>
              <View style={styles.journalIntroFooter}>
                <Text style={styles.journalCaption}>여행은 결국,{ '\n' }함께한 시간을 기억하는 일.</Text>
                {homeTripRecord ? (
                  <View style={styles.journalTripStamp}>
                    <Text style={styles.journalTripStampDate}>{formatJournalDate(homeTripRecord.trip.dateRange)}</Text>
                    <Text style={styles.journalTripStampPlace} numberOfLines={1}>{homeTripRecord.trip.name}</Text>
                  </View>
                ) : null}
              </View>
            </View>

            {homeTripRecord ? (
              <Pressable
                style={styles.journalHero}
                onPress={() => openTrip(homeTripRecord.group.id, homeTripRecord.trip.id)}
                accessibilityRole="button"
                accessibilityLabel={`${homeTripRecord.trip.name} 여행 표지 보기`}
              >
                {homeTripCoverPhoto ? (
                  <Image
                    source={{ uri: homeTripCoverPhoto.uri }}
                    style={styles.journalHeroImage}
                    resizeMode="cover"
                    accessibilityLabel={`${homeTripRecord.trip.name} 여행 대표 사진`}
                  />
                ) : <TripFallbackCover option={homeFallbackOption} style={styles.journalHeroImage} />}
                <PhotoCloudFade edge="top" />
                <PhotoCloudFade edge="bottom" />
              </Pressable>
            ) : <View style={styles.journalHero}><TripFallbackCover option={2} style={styles.journalHeroImage} /><PhotoCloudFade edge="top" /><PhotoCloudFade edge="bottom" /></View>}

            {!homeTripCoverPhoto ? (
              <Pressable
                style={styles.journalHeroActionRow}
                onPress={() => homeTripRecord
                  ? openTrip(homeTripRecord.group.id, homeTripRecord.trip.id)
                  : groups.length > 0 ? openGroup(groups[0].id) : startCreateGroup()}
                accessibilityRole="button"
              >
                <Text style={styles.journalHeroActionText}>
                  {homeTripRecord ? '이 여행에 사진 추가' : groups.length > 0 ? '새 여행 만들기' : '첫 모임 만들기'}
                </Text>
                <Text style={styles.journalHeroActionArrow}>→</Text>
              </Pressable>
            ) : null}

            <View style={styles.journalSectionHeader}>
              <Text style={styles.journalSectionTitle}>최근 여행</Text>
              <Pressable onPress={() => openTab('trips')} accessibilityRole="button">
                <Text style={styles.journalSeeAll}>모든 여행 보기  ›</Text>
              </Pressable>
            </View>
            {tripRecords.length > 0 ? (
              tripRecords.slice(0, 5).map(({ group: recordGroup, trip: recordTrip }, index) => (
                <JournalTripRow
                  key={`${recordGroup.id}-${recordTrip.id}`}
                  group={recordGroup}
                  trip={recordTrip}
                  fallbackOption={getTripFallbackCoverOption(tripsForCoverOrder, index) ?? 2}
                  onPress={() => openTrip(recordGroup.id, recordTrip.id)}
                />
              ))
            ) : (
              <EmptyCard
                title={groups.length === 0 ? '첫 여행 기록을 만들어 볼까요?' : '아직 여행 기록이 없어요'}
                description={groups.length === 0 ? '친구들과 모임을 만들고 다녀온 곳을 기록해 보세요.' : '모임에서 여행을 만들면 이곳에서 최근 기록을 볼 수 있어요.'}
              />
            )}
            <Text style={styles.journalLocalNote}>여행 기록은 이 기기에 저장돼요. 다른 기기와 공유는 아직 지원하지 않아요.</Text>
          </>
        )}

        {screen === 'groups' && (
          <>
            <SectionTitle title="받은 모임 초대" trailing={groupInvitations.length > 0 ? `${groupInvitations.length}개` : undefined} onRefresh={() => { if (authUser?.id) void refreshRemoteGroupData(authUser.id); }} />
            {groupInvitationState === 'loading' ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 14 }} /> : null}
            {groupInvitationState === 'error' ? <View style={styles.groupInvitationCard}>
              <Text style={styles.cardDescription}>초대함을 불러오지 못했어요.</Text>
            </View> : null}
            {groupInvitationState === 'ready' && groupInvitations.length === 0 ? <Text style={styles.groupInvitationEmpty}>새로운 초대가 여기에 표시돼요.</Text> : null}
            {groupInvitationState === 'ready' && groupInvitations.map((invitation) => (
              <View key={invitation.invitationId} style={styles.groupInvitationCard} accessibilityLabel={invitation.groupName + " 모임 초대, " + invitation.memberName + " 이름으로 초대됨, 대기 중"}>
                <View style={styles.cardMain}>
                  <Text style={styles.cardTitle}>{invitation.groupName}</Text>
                  <Text style={styles.cardDescription}>내 이름을 {invitation.memberName}(으)로 등록해 초대했어요. 아직 대기 중이에요.</Text>
                </View>
                <Pressable
                  onPress={() => { void acceptGroupInvitation(invitation); }}
                  disabled={acceptingInvitationId !== null}
                  accessibilityRole="button"
                  accessibilityLabel={`${invitation.groupName} 모임 초대 수락`}
                  accessibilityState={{ disabled: acceptingInvitationId !== null }}
                  style={[styles.groupInvitationAccept, acceptingInvitationId !== null && styles.disabledButton]}
                >
                  {acceptingInvitationId === invitation.invitationId
                    ? <ActivityIndicator color={colors.primaryDark} />
                    : <Text style={styles.groupInvitationAcceptText}>수락</Text>}
                </Pressable>
              </View>
            ))}
            <Text style={styles.pageTitle}>내 모임</Text>
            <Text style={styles.pageDescription}>친구 모임을 나누어 여행과 지출을 관리해요.</Text>
            <PrimaryButton title="새 모임 만들기" onPress={startCreateGroup} />
            <SectionTitle title="모임 목록" trailing={`${groups.length}개`} />
            {authUser && remoteGroupSnapshotState === 'loading' ? <View style={styles.groupInvitationCard} accessibilityRole="progressbar"><ActivityIndicator color={colors.primary} /><Text style={styles.cardDescription}>모임 멤버 정보를 확인하고 있어요.</Text></View> : null}
            {authUser && remoteGroupSnapshotState === 'error' ? <View style={styles.groupInvitationCard}><Text style={styles.cardDescription}>모임 멤버 정보를 불러오지 못했어요. 인원수를 확인할 수 없습니다.</Text><SecondaryButton title="다시 시도" compact onPress={() => { if (authUser?.id) void refreshRemoteGroupData(authUser.id); }} /></View> : null}
            {groups.length === 0 ? (
              <EmptyCard title="아직 만든 모임이 없어요" description="친구 이름을 추가해 첫 모임을 만들어 보세요." />
            ) : groups.map((item) => (
              <Pressable key={item.id} style={styles.groupCard} onPress={() => openGroup(item.id)} accessibilityRole="button">
                <View style={styles.groupIcon}><Text style={styles.groupIconText}>{item.name.slice(0, 1)}</Text></View>
                <View style={styles.cardMain}>
                  <Text style={styles.cardTitle}>{item.name}</Text>
                  <Text style={styles.cardDescription}>{authUser && remoteGroupSnapshotState === 'loading' ? `멤버 수 확인 중 · 여행 ${item.trips.length}개` : authUser && remoteGroupSnapshotState === 'error' ? `멤버 수 확인 불가 · 여행 ${item.trips.length}개` : `멤버 ${item.members.filter((member) => isMemberActiveForDisplay(member.id, remoteMemberStatuses[item.id]?.[member.id], Boolean(authUser))).length}명 · 여행 ${item.trips.length}개`}</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            ))}
          </>
        )}

        {screen === 'trips' && (
          <>
            <Text style={styles.eyebrow}>ALL TRIPS</Text>
            <Text style={styles.pageTitle}>여행 기록</Text>
            <Text style={styles.pageDescription}>모든 모임의 여행을 날짜순으로 모아봤어요.</Text>
            <View style={styles.dashboardStatsRow}>
              <DashboardStat label="여행" value={`${tripRecords.length}`} unit="개" />
              <DashboardStat label="누적 지출" value={money(allExpenseTotal)} compact />
            </View>
            <Pressable style={styles.tripSettlementShortcut} onPress={() => setScreen('settlements')} accessibilityRole="button" accessibilityLabel={`정산 기록 ${settlementRecords.length}개 보기`}>
              <View style={styles.cardMain}>
                <Text style={styles.tripSettlementShortcutTitle}>정산 기록</Text>
                <Text style={styles.tripSettlementShortcutDescription}>지출이 있는 여행 {settlementRecords.length}개 · 진행 중과 완료된 정산 보기</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
            <SectionTitle title="전체 여행" trailing={`${tripRecords.length}개`} />
            {tripRecords.length === 0 ? (
              <EmptyCard title="아직 여행 기록이 없어요" description={groups.length === 0 ? '모임을 먼저 만들고 첫 여행을 준비해 보세요.' : '모임을 열어 여행을 만들면 여기에 모두 모여요.'} />
            ) : tripRecords.map(({ group: recordGroup, trip: recordTrip }) => (
              <TripRecordCard
                key={`${recordGroup.id}-${recordTrip.id}`}
                group={recordGroup}
                trip={recordTrip}
                onPress={() => openTrip(recordGroup.id, recordTrip.id)}
              />
            ))}
          </>
        )}

        {screen === 'map' && (
          <>
            <Text style={styles.eyebrow}>TRAVEL MEMORIES</Text>
            <Text style={styles.pageTitle}>추억 지도</Text>
            <Text style={styles.pageDescription}>사진에 기록된 위치를 여행별로 모아봐요.</Text>
            <View style={styles.mapCanvas}>
              <MapView
                style={styles.mapView}
                initialRegion={mapRegion}
                accessibilityLabel="여행 사진 위치 지도"
              >
                {geotaggedPhotos.map(({ group: photoGroup, trip: photoTrip, photo }) => (
                  <Marker
                    key={`${photoTrip.id}-${photo.id}`}
                    coordinate={{ latitude: photo.latitude as number, longitude: photo.longitude as number }}
                    title={photoTrip.name}
                    description={`${photoGroup.name} · ${photoTrip.destination}`}
                    onCalloutPress={() => openTrip(photoGroup.id, photoTrip.id)}
                  />
                ))}
              </MapView>
              {geotaggedPhotos.length === 0 ? (
                <View pointerEvents="none" style={styles.mapEmptyOverlay}>
                  <Text style={styles.mapEmptyOverlayTitle}>사진의 위치가 여기에 쌓여요</Text>
                  <Text style={styles.mapEmptyOverlayText}>여행 상세에서 위치 정보가 있는 사진을 추가해 보세요.</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.mapPrivacyNote}>위치 정보가 있는 사진만 표시해요. 위치가 없는 사진은 여행 사진에 남고 지도에는 나오지 않습니다.</Text>
            <SectionTitle title="지도에 표시된 사진" trailing={`${geotaggedPhotos.length}장`} />
            {geotaggedPhotos.length === 0 ? (
              <EmptyCard title="아직 지도에 표시할 사진이 없어요" description="사진 추가 시 원본의 위치 정보가 있으면 이곳에 표시됩니다." />
            ) : geotaggedPhotos.map(({ group: photoGroup, trip: photoTrip, photo }) => (
              <Pressable
                key={`${photoTrip.id}-${photo.id}`}
                style={styles.destinationRow}
                onPress={() => openTrip(photoGroup.id, photoTrip.id)}
                accessibilityRole="button"
              >
                <Image source={{ uri: photo.uri }} style={styles.mapPhotoThumb} />
                <View style={styles.cardMain}>
                  <Text style={styles.cardTitle}>{photoTrip.name}</Text>
                  <Text style={styles.cardDescription}>{photoGroup.name} · {photoTrip.destination}</Text>
                  <Text style={styles.mapPhotoCoordinates}>{photo.latitude?.toFixed(5)}, {photo.longitude?.toFixed(5)}</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            ))}
          </>
        )}

        {screen === 'settlements' && (
          <>
            <Text style={styles.eyebrow}>SETTLEMENTS</Text>
            <Text style={styles.pageTitle}>여행 정산</Text>
            <Text style={styles.pageDescription}>진행 중인 정산과 완료된 정산을 확인해요.</Text>
            <SectionTitle title="정산 기록" trailing={`${settlementRecords.length}개`} />
            {settlementRecords.length === 0 ? (
              <EmptyCard title="정산할 여행이 아직 없어요" description="여행에서 지출을 기록하면 멤버별 정산을 확인할 수 있어요." />
            ) : settlementRecords.map(({ group: recordGroup, trip: recordTrip }) => {
              const total = recordTrip.expenses.reduce((sum, expense) => sum + expense.amount, 0);
              return (
                <Pressable
                  key={`${recordGroup.id}-${recordTrip.id}`}
                  style={styles.settlementRecordCard}
                  onPress={() => openTrip(recordGroup.id, recordTrip.id, 'settlement')}
                  accessibilityRole="button"
                >
                  <View style={styles.tripCardTop}>
                    <Text style={[styles.cardTitle, styles.settlementTripTitle]} numberOfLines={1}>{recordTrip.name}</Text>
                    <View style={styles.tripRecordTrailing}>
                      <SettlementStatusBadge completed={Boolean(recordTrip.settledAt)} />
                      <Text style={styles.chevron}>›</Text>
                    </View>
                  </View>
                  <Text style={styles.cardDescription}>{recordGroup.name} · {recordTrip.dateRange}</Text>
                  <View style={styles.settlementRecordSummary}>
                    <Text style={styles.cardDescription}>지출 {recordTrip.expenses.length}건</Text>
                    <Text style={styles.tripAmount}>{money(total)}</Text>
                  </View>
                </Pressable>
              );
            })}
          </>
        )}

        {screen === 'create-group' && (
          <>
            <Text style={styles.eyebrow}>NEW CIRCLE</Text>
            <Text style={styles.pageTitle}>친구 모임 만들기</Text>
            <Text style={styles.pageDescription}>내 닉네임은 자동으로 멤버에 들어가요. 이름을 직접 쓰거나 연결된 친구를 여러 명 선택해 주세요.</Text>
            <Field
              label="모임 이름"
              value={groupName}
              onChangeText={setGroupName}
              placeholder="예: 대학 친구들"
              inputRef={groupNameInput}
              returnKeyType="next"
              onSubmitEditing={() => memberNameInput.current?.focus()}
              onFocus={() => scrollFocusedInputIntoView(groupNameInput.current)}
              inputAccessoryViewID="group-name-keyboard-action"
              accessoryLabel="다음"
              onAccessoryPress={() => memberNameInput.current?.focus()}
            />
            <View style={styles.groupOwnerMemberPreview}>
              <View style={styles.groupOwnerBadge}><Text style={styles.groupOwnerBadgeText}>나</Text></View>
              <Text style={styles.groupOwnerMemberName}>{ownerNickname || '내 계정 닉네임'}</Text>
              <Text style={styles.groupOwnerMemberHint}>자동 포함</Text>
            </View>
            <Text style={styles.fieldLabel}>친구 추가</Text>
            <View style={styles.memberEntryRow}>
              <TextInput
                value={memberNameDraft}
                onChangeText={setMemberNameDraft}
                ref={memberNameInput}
                onSubmitEditing={() => {
                  addMember();
                  requestAnimationFrame(() => memberNameInput.current?.focus());
                }}
                onFocus={() => scrollFocusedInputIntoView(memberNameInput.current)}
                inputAccessoryViewID="member-name-keyboard-action"
                placeholder="친구 닉네임 또는 이름"
                placeholderTextColor={colors.muted}
                returnKeyType="send"
                style={[styles.input, styles.memberEntryInput]}
              />
              <KeyboardActionAccessory
                nativeID="member-name-keyboard-action"
                label="멤버 추가"
                onPress={() => {
                  addMember();
                  requestAnimationFrame(() => memberNameInput.current?.focus());
                }}
              />
              <Pressable onPress={addMember} style={styles.memberAddButton} accessibilityRole="button">
                <Text style={styles.memberAddButtonText}>추가</Text>
              </Pressable>
            </View>
            <Text style={styles.fieldLabel}>앱 친구에서 선택</Text>
            <Text style={styles.groupFriendPickerHint}>수락된 친구는 모임을 만들면 초대돼요. 초대 수락 전에는 상대 모임 목록에 나타나지 않아요. 직접 입력한 사람은 이름만 게스트로 저장돼요.</Text>
            {(socialData?.friends.length ?? 0) > 0 ? (
              <View style={styles.groupFriendPicker}>
                {socialData?.friends.map((friend) => {
                  const selected = selectedGroupFriendIds.includes(friend.user_id);
                  const alreadyAdded = [ownerNickname, ...memberNames].some((name) => name.trim().toLocaleLowerCase() === friend.nickname.trim().toLocaleLowerCase());
                  return (
                    <Pressable
                      key={friend.user_id}
                      style={[styles.groupFriendChoiceRow, selected && styles.groupFriendChoiceRowSelected]}
                      onPress={() => toggleGroupFriendSelection(friend.user_id)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                    >
                      <View style={[styles.groupFriendCheckbox, selected && styles.groupFriendCheckboxSelected]}>
                        {selected ? <Text style={styles.groupFriendCheckboxMark}>✓</Text> : null}
                      </View>
                      <Text style={styles.groupFriendChoiceName}>{friend.nickname}</Text>
                      {alreadyAdded ? <Text style={styles.groupFriendAddedLabel}>추가됨</Text> : null}
                    </Pressable>
                  );
                })}
                {selectedGroupFriendIds.length > 0 ? (
                  <Pressable style={styles.groupFriendAddButton} onPress={addSelectedGroupFriends} accessibilityRole="button">
                    <Text style={styles.groupFriendAddButtonText}>선택한 친구 {selectedGroupFriendIds.length}명 추가</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <Text style={styles.memberHint}>연결된 앱 친구가 없어요. 이름을 직접 입력해 추가할 수 있어요.</Text>
            )}
            {memberNames.length > 0 ? (
              <View style={styles.memberList}>
                {memberNames.map((name, index) => (
                  <View key={`${name}-${index}`} style={styles.memberListItem}>
                    <View style={styles.memberListNumber}>
                      <Text style={styles.memberListNumberText}>{index + 2}</Text>
                    </View>
                    <Text style={styles.memberListName}>{name}</Text>
                    <Pressable
                      onPress={() => {
                        setMemberNames((current) => current.filter((_, memberIndex) => memberIndex !== index));
                        setGroupMemberAccounts((current) => {
                          const next = { ...current };
                          delete next[name];
                          return next;
                        });
                      }}
                      style={styles.memberRemoveButton}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`${name} 삭제`}
                    >
                      <Text style={styles.memberRemoveText}>×</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.memberHint}>앱에 등록되지 않은 친구도 이름으로 추가할 수 있어요. 모임에는 나와 친구 한 명 이상이 필요해요.</Text>
            )}
            <PrimaryButton title={groupCreating ? '저장 중…' : '모임 만들기'} onPress={() => { void createGroup(); }} disabled={groupCreating} />
          </>
        )}

        {screen === 'group' && group && (
          <>
            <Text style={styles.eyebrow}>FRIENDS CIRCLE</Text>
            <View style={styles.groupTitleRow}>
              <Text style={[styles.pageTitle, styles.groupTitleText]}>{group.name}</Text>
              <Pressable onPress={startEditGroup} style={styles.editTripButton} accessibilityRole="button" accessibilityLabel="모임 수정">
                <Text style={styles.editTripButtonText}>수정</Text>
              </Pressable>
            </View>
            {authUser && remoteGroupSnapshotState === 'loading' ? <View style={styles.groupInvitationCard} accessibilityRole="progressbar"><ActivityIndicator color={colors.primary} /><Text style={styles.cardDescription}>멤버 상태를 확인하고 있어요.</Text></View> : null}
            {authUser && remoteGroupSnapshotState === 'error' ? <View style={styles.groupInvitationCard}><Text style={styles.cardDescription}>멤버 상태를 확인하지 못했어요. 수락 대기 여부와 인원수를 표시할 수 없습니다.</Text><SecondaryButton title="다시 시도" compact onPress={() => { if (authUser?.id) void refreshRemoteGroupData(authUser.id); }} /></View> : null}
            {(!authUser || remoteGroupSnapshotState === 'ready') ? <View accessibilityLabel="모임 구성원 상태">
              {group.members.some((member) => remoteMemberStatuses[group.id]?.[member.id] === 'pending') ? <>
                <SectionTitle title="초대 수락 대기" trailing={`${group.members.filter((member) => remoteMemberStatuses[group.id]?.[member.id] === 'pending').length}명`} />
                <View style={styles.memberChipFlow}>{group.members.filter((member) => remoteMemberStatuses[group.id]?.[member.id] === 'pending').map((member) => <GroupMemberChip key={member.id} member={member} status="pending" owner={member.id === group.members[0]?.id} registered={Boolean(remoteMemberAccounts[group.id]?.[member.id])} />)}</View>
              </> : null}
              {group.members.some((member) => isMemberActiveForDisplay(member.id, remoteMemberStatuses[group.id]?.[member.id], Boolean(authUser))) ? <>
                <SectionTitle title="참여 중" trailing={`${group.members.filter((member) => isMemberActiveForDisplay(member.id, remoteMemberStatuses[group.id]?.[member.id], Boolean(authUser))).length}명`} />
                <View style={styles.memberChipFlow}>{group.members.filter((member) => isMemberActiveForDisplay(member.id, remoteMemberStatuses[group.id]?.[member.id], Boolean(authUser))).map((member) => <GroupMemberChip key={member.id} member={member} status="active" owner={member.id === group.members[0]?.id} registered={Boolean(remoteMemberAccounts[group.id]?.[member.id])} />)}</View>
              </> : null}
              {group.members.some((member) => remoteMemberStatuses[group.id]?.[member.id] === 'removed') ? <>
                <SectionTitle title="탈퇴 또는 제외" trailing={`${group.members.filter((member) => remoteMemberStatuses[group.id]?.[member.id] === 'removed').length}명`} />
                <View style={styles.memberChipFlow}>{group.members.filter((member) => remoteMemberStatuses[group.id]?.[member.id] === 'removed').map((member) => <GroupMemberChip key={member.id} member={member} status="removed" owner={member.id === group.members[0]?.id} registered={Boolean(remoteMemberAccounts[group.id]?.[member.id])} />)}</View>
              </> : null}
            </View> : null}
            {isGroupOwner ? <SecondaryButton title={groupActionBusy ? '삭제 중…' : '모임 삭제'} onPress={() => Alert.alert('모임을 삭제할까요?', '모임과 여행 기록이 영구 삭제돼요.', [{ text: '취소', style: 'cancel' }, { text: '삭제', style: 'destructive', onPress: () => { void deleteGroup(); } }])} disabled={groupActionBusy} /> : isAccountMember ? <SecondaryButton title={groupActionBusy ? '처리 중…' : '모임 탈퇴'} onPress={() => Alert.alert('모임에서 나갈까요?', '모임에서 나가면 목록에서 사라져요.', [{ text: '취소', style: 'cancel' }, { text: '탈퇴', style: 'destructive', onPress: () => { void leaveGroup(); } }])} disabled={groupActionBusy} /> : null}
            {(!authUser || remoteGroupSnapshotState === 'ready') ? <Text style={styles.pageDescription}>{group.members.filter((member) => isMemberActiveForDisplay(member.id, remoteMemberStatuses[group.id]?.[member.id], Boolean(authUser))).map((member) => member.name).join(' · ')}</Text> : null}
            <PrimaryButton title={group.trips.length === 0 ? "첫 여행 만들기" : "새 여행 만들기"} onPress={startCreateTrip} disabled={tripSaving || (Boolean(authUser) && remoteGroupSnapshotState !== 'ready')} />
            <SectionTitle title="여행" trailing={`${group.trips.length}개`} />
            {group.trips.length === 0 ? (
              <EmptyCard title="아직 여행이 없어요" description="날짜와 총무를 정해 첫 여행을 만들어 보세요." />
            ) : group.trips.map((item) => (
              <Pressable key={item.id} style={styles.tripCard} onPress={() => {
                setSelectedTripId(item.id);
                setScreen('trip');
              }}>
                <View style={styles.tripCardTop}>
                  <Text style={styles.cardTitle}>{item.name}</Text>
                  <Text style={styles.chevron}>›</Text>
                </View>
                {getTripPhase(item) === 'planned' && getTripDday(item.dateRange, tripDateNow) !== null ? (
                  <Text style={styles.tripDday} accessibilityRole="text">{formatTripDday(getTripDday(item.dateRange, tripDateNow)!)}</Text>
                ) : null}
                <Text style={styles.cardDescription}>
                  {item.destination}{item.detailAddress ? ` · ${item.detailAddress}` : ''} · {item.dateRange}
                </Text>
                <Text style={styles.tripAmount}>
                  지출 {money(item.expenses.reduce((sum, expense) => sum + expense.amount, 0))}
                </Text>
              </Pressable>
            ))}
          </>
        )}

        {screen === 'edit-group' && group && (
          <>
            <Text style={styles.eyebrow}>EDIT CIRCLE</Text>
            <Text style={styles.pageTitle}>모임 수정</Text>
            <Text style={styles.pageDescription}>모임 이름과 멤버 명단을 수정해요. 여행과 정산 기록은 그대로 유지돼요.</Text>
            <Field
              label="모임 이름"
              value={editGroupName}
              onChangeText={setEditGroupName}
              placeholder="모임 이름"
              inputRef={editGroupNameInput}
              returnKeyType="next"
              onSubmitEditing={() => (editMembers[1] ? editMemberInputs.current[editMembers[1].id] : editMemberNameInput.current)?.focus()}
              onFocus={() => scrollFocusedInputIntoView(editGroupNameInput.current)}
              inputAccessoryViewID="edit-group-name-keyboard-action"
              accessoryLabel="다음"
              onAccessoryPress={() => (editMembers[1] ? editMemberInputs.current[editMembers[1].id] : editMemberNameInput.current)?.focus()}
            />
            <View style={styles.groupOwnerMemberPreview}>
              <View style={styles.groupOwnerBadge}><Text style={styles.groupOwnerBadgeText}>나</Text></View>
              <Text style={styles.groupOwnerMemberName}>{editMembers[0]?.name ?? group.members[0]?.name}</Text>
              <Text style={styles.groupOwnerMemberHint}>모임 만든 사람 · 삭제 불가</Text>
            </View>
            <Text style={styles.fieldLabel}>멤버 이름 수정</Text>
            <View style={styles.memberList}>
              {editMembers.slice(1).map((member, index) => (
                <View key={member.id} style={styles.memberListItem}>
                  <View style={styles.memberListNumber}><Text style={styles.memberListNumberText}>{index + 2}</Text></View>
                  <TextInput
                    value={member.name}
                    onChangeText={(name) => setEditMembers((current) => current.map((item) => item.id === member.id ? { ...item, name } : item))}
                    ref={(input) => { editMemberInputs.current[member.id] = input; }}
                    onFocus={() => scrollFocusedInputIntoView(editMemberInputs.current[member.id])}
                    returnKeyType="done"
                    style={[styles.input, styles.editMemberInput]}
                    accessibilityLabel={`${index + 2}번째 멤버 이름`}
                  />
                  <Pressable
                    onPress={() => removeEditMember(member.id)}
                    style={styles.memberRemoveButton}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`${member.name || '멤버'} 삭제`}
                  >
                    <Text style={styles.memberRemoveText}>×</Text>
                  </Pressable>
                </View>
              ))}
            </View>
            <Text style={styles.memberHint}>여행의 총무·결제자·지출 참여자는 기록 보호를 위해 삭제할 수 없어요.</Text>
            <Text style={styles.fieldLabel}>친구 추가</Text>
            <View style={styles.memberEntryRow}>
              <TextInput
                value={editMemberDraft}
                onChangeText={setEditMemberDraft}
                ref={editMemberNameInput}
                onSubmitEditing={() => {
                  addEditMember();
                  requestAnimationFrame(() => editMemberNameInput.current?.focus());
                }}
                onFocus={() => scrollFocusedInputIntoView(editMemberNameInput.current)}
                inputAccessoryViewID="edit-member-name-keyboard-action"
                placeholder="친구 닉네임 또는 이름"
                placeholderTextColor={colors.muted}
                returnKeyType="send"
                style={[styles.input, styles.memberEntryInput]}
              />
              <KeyboardActionAccessory
                nativeID="edit-member-name-keyboard-action"
                label="멤버 추가"
                onPress={() => {
                  addEditMember();
                  requestAnimationFrame(() => editMemberNameInput.current?.focus());
                }}
              />
              <Pressable onPress={addEditMember} style={styles.memberAddButton} accessibilityRole="button">
                <Text style={styles.memberAddButtonText}>추가</Text>
              </Pressable>
            </View>
            <Text style={styles.fieldLabel}>앱 친구에서 선택</Text>
            <Text style={styles.groupFriendPickerHint}>선택한 친구는 현재 이 기기의 모임 명단에만 추가돼요. 친구에게 초대나 여행 기록은 전달되지 않아요.</Text>
            {(socialData?.friends.length ?? 0) > 0 ? (
              <View style={styles.groupFriendPicker}>
                {socialData?.friends.map((friend) => {
                  const selected = selectedEditFriendIds.includes(friend.user_id);
                  const alreadyAdded = editMembers.some((member) => member.name.trim().toLocaleLowerCase() === friend.nickname.trim().toLocaleLowerCase());
                  return (
                    <Pressable
                      key={friend.user_id}
                      style={[styles.groupFriendChoiceRow, selected && styles.groupFriendChoiceRowSelected]}
                      onPress={() => {
                        Keyboard.dismiss();
                        setSelectedEditFriendIds((current) => current.includes(friend.user_id)
                          ? current.filter((id) => id !== friend.user_id)
                          : [...current, friend.user_id]);
                      }}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                    >
                      <View style={[styles.groupFriendCheckbox, selected && styles.groupFriendCheckboxSelected]}>
                        {selected ? <Text style={styles.groupFriendCheckboxMark}>✓</Text> : null}
                      </View>
                      <Text style={styles.groupFriendChoiceName}>{friend.nickname}</Text>
                      {alreadyAdded ? <Text style={styles.groupFriendAddedLabel}>추가됨</Text> : null}
                    </Pressable>
                  );
                })}
                {selectedEditFriendIds.length > 0 ? (
                  <Pressable style={styles.groupFriendAddButton} onPress={addSelectedEditFriends} accessibilityRole="button">
                    <Text style={styles.groupFriendAddButtonText}>선택한 친구 {selectedEditFriendIds.length}명 추가</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <Text style={styles.memberHint}>연결된 앱 친구가 없어요. 이름을 직접 입력해 추가할 수 있어요.</Text>
            )}
            <PrimaryButton title="수정 완료" onPress={saveGroupEdits} />

            <Pressable onPress={confirmDeleteGroup} style={styles.deleteGroupAction} accessibilityRole="button" accessibilityLabel={`${group.name} 모임 삭제`}><Text style={styles.deleteGroupActionText}>모임 삭제</Text></Pressable>
            <SecondaryButton title="취소" onPress={() => { Keyboard.dismiss(); setScreen('group'); }} compact />
          </>
        )}

        {(screen === 'create-trip' || screen === 'edit-trip') && group && (
          <>
            <Text style={styles.eyebrow}>{screen === 'edit-trip' ? 'EDIT TRIP' : 'NEW TRIP'}</Text>
            <Text style={styles.pageTitle}>{screen === 'edit-trip' ? '여행 정보를 수정해요' : '여행을 준비해요'}</Text>
            <Text style={styles.pageDescription}>국내 여행의 기본 정보를 입력해 주세요.</Text>
            <Field
              label="여행 이름"
              value={tripName}
              onChangeText={setTripName}
              placeholder="예: 강릉 바다 여행"
              returnKeyType="done"
              onSubmitEditing={Keyboard.dismiss}
              inputAccessoryViewID="trip-name-keyboard-action"
              accessoryLabel="완료"
              onAccessoryPress={Keyboard.dismiss}
            />
            <RegionPicker
              value={destination}
              onChange={setDestination}
              detailAddress={detailAddress}
              onDetailAddressChange={setDetailAddress}
              onInputFocus={scrollFocusedInputIntoView}
            />
            <DateRangePicker
              startDate={tripStartDate}
              endDate={tripEndDate}
              onStartDateChange={(date) => {
                setTripStartDate(date);
                if (tripEndDate && date > tripEndDate) setTripEndDate(null);
              }}
              onEndDateChange={setTripEndDate}
            />
            <Text style={styles.fieldLabel}>총무</Text>
            <View style={styles.chipWrap}>
              {group.members.map((member) => (
                <ChoiceChip key={member.id} label={member.name} selected={treasurerId === member.id} onPress={() => setTreasurerId(member.id)} />
              ))}
            </View>
            <PrimaryButton title={tripSaving ? "저장 중…" : screen === 'edit-trip' ? "수정 완료" : "여행 만들기"} onPress={() => { void saveTrip(); }} disabled={tripSaving} />
          </>
        )}

        {screen === 'trip' && group && trip && (
          <>
            <View style={styles.tripHero}>
              <View style={styles.tripHeadingRow}>
                <View style={styles.tripHeadingText}>
                  <Text style={styles.eyebrow}>DOMESTIC TRIP</Text>
                  <Text style={styles.pageTitle}>{trip.name}</Text>
                </View>
                <Pressable onPress={startEditTrip} style={styles.editTripButton} accessibilityRole="button" accessibilityLabel="여행 정보 수정">
                  <Text style={styles.editTripButtonText}>수정</Text>
                </Pressable>
              </View>
              <Text style={styles.pageDescription}>
                {trip.destination}{trip.detailAddress ? ` · ${trip.detailAddress}` : ''} · {trip.dateRange}
              </Text>
              <View style={styles.heroDivider} />
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>총 지출</Text>
                <Text style={styles.summaryAmount}>{money(tripTotal)}</Text>
              </View>
              <Text style={styles.treasurerText}>총무 · {treasurer?.name ?? '미정'}</Text>
              <View style={styles.tripStatusRow}>
                <TripPhaseBadge phase={getTripPhase(trip)} />
                {getTripPhase(trip) === 'planned' && getTripDday(trip.dateRange, tripDateNow) !== null ? (
                  <Text style={styles.tripDday} accessibilityRole="text">{formatTripDday(getTripDday(trip.dateRange, tripDateNow)!)}</Text>
                ) : null}
                <SettlementStatusBadge completed={Boolean(trip.settledAt)} />
                {trip.settledAt ? <Text style={styles.settledDate}>완료 {new Date(trip.settledAt).toLocaleDateString('ko-KR')}</Text> : null}
              </View>
            </View>
            {remoteGroupSnapshotState === 'ready' && isGroupOwner && isAccountMember && remoteGroupDbIds[group.id] && supabase ? (
              <SecondaryButton
                title={tripDeleteBusy ? '여행 삭제 중…' : '여행 삭제'}
                onPress={requestDeleteTrip}
                disabled={tripDeleteBusy}
              />
            ) : null}
            {getTripPhase(trip) === 'planned' ? (
              authUser && isAccountMember && tripStartPrompt ? <PrimaryButton title={tripStartBusy ? '여행 시작 중' : '여행 시작 확인'} onPress={() => confirmStartTrip(tripStartPrompt.groupDbId, group.id, trip.id)} disabled={tripStartBusy || remoteGroupSnapshotState !== 'ready'} /> : null
            ) : getTripPhase(trip) === 'ended' ? (
              trip.settledAt
                ? <SecondaryButton title="여행 종료" onPress={() => {}} disabled />
                : <SecondaryButton title="여행 다시 진행" onPress={changeTripPhase} />
            ) : (
              <PrimaryButton title="여행 종료" onPress={changeTripPhase} />
            )}
            <View style={styles.actionRow}>
              {trip.settledAt ? (
                <SecondaryButton title="지출 추가 마감" onPress={() => {}} disabled compact />
              ) : (
                <PrimaryButton title="지출 추가" onPress={startAddExpense} compact />
              )}
              <SecondaryButton title="정산 결과 보기" onPress={() => { setSettlementReturnScreen('trip'); setScreen('settlement'); }} disabled={trip.expenses.length === 0} compact />
            </View>
            <TripPhotos
              tripId={trip.id}
              photos={trip.photos ?? []}
              coverPhotoId={trip.coverPhotoId}
              onChange={saveTripPhotos}
              onCoverPhotoChange={saveTripCoverPhoto}
              onAddPhotos={handleTripPhotosAdded}
              onRemovePhoto={handleTripPhotoRemoved}
            />
            {authUser && isAccountMember && remoteGroupSnapshotState === 'ready' && selectedGroupDbId && supabase ? (
              <>
                <SectionTitle title="활동 내역" />
                {groupActivityUi?.key !== groupActivityKey || groupActivityUi.status === 'loading' ? (
                  <View style={styles.groupActivityStatus} accessibilityRole="progressbar"><ActivityIndicator color={colors.primary} /><Text style={styles.cardDescription}>활동 내역을 불러오고 있어요.</Text></View>
                ) : groupActivityUi.status === 'error' ? (
                  <View style={styles.groupActivityStatus}><Text style={styles.cardDescription}>활동 내역을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</Text><SecondaryButton title="다시 시도" compact onPress={() => setGroupActivityReload((value) => value + 1)} /></View>
                ) : groupActivityUi.events.length === 0 ? (
                  <Text style={styles.groupActivityEmpty}>아직 표시할 활동 내역이 없어요.</Text>
                ) : <>
                  {groupActivityUi.events.map((event) => {
                    const eventDate = new Date(event.occurredAt);
                    const occurredLabel = Number.isNaN(eventDate.getTime()) ? '' : eventDate.toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
                    return <View key={event.id} style={styles.groupActivityRow}>
                      <View style={styles.groupActivityDot} />
                      <View style={styles.groupActivityContent}>
                        <Text style={styles.groupActivityMeta}>여행: {trip.name}</Text>
                        <Text style={styles.groupActivityLabel}>{groupActivityLabels[event.type]}</Text>
                        {event.type === 'expense_added' && event.expense ? (
                          <Text style={styles.groupActivityExpense} numberOfLines={2}>
                            {event.expense.title} · {money(event.expense.amountKrw)}
                          </Text>
                        ) : null}
                        <Text style={styles.groupActivityMeta}>{event.actor?.displayName ?? '현재 멤버 정보 없음'} · {occurredLabel}</Text>
                      </View>
                    </View>;
                  })}
                  {groupActivityUi.moreError ? <View style={styles.groupActivityStatus}><Text style={styles.cardDescription}>이전 활동 내역을 불러오지 못했어요.</Text></View> : null}
                  {groupActivityUi.nextCursor ? <Pressable style={styles.groupActivityMore} onPress={() => { void loadMoreGroupActivity(); }} disabled={groupActivityUi.loadingMore} accessibilityRole="button" accessibilityLabel={groupActivityUi.moreError ? '이전 활동 내역 다시 시도' : '활동 내역 더 보기'}>
                    {groupActivityUi.loadingMore ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.groupActivityMoreText}>{groupActivityUi.moreError ? '다시 시도' : '더 보기'}</Text>}
                  </Pressable> : null}
                </>}
              </>
            ) : null}
            {authUser && isAccountMember && remoteGroupDbIds[group.id] ? (
              <View style={styles.groupInvitationCard} accessibilityLiveRegion="polite">
                {tripSyncOutcomeTripKey === `${group.id}:${trip.id}` && tripSyncOutcome ? <Text accessibilityLabel={tripSyncOutcomeCommandId ? "동기화 요청 결과" : "기기 저장 상태"} style={styles.cardDescription}>{tripSyncOutcome === 'local-save-failed' ? '이 기기 저장 실패' : tripSyncOutcome === 'applied' ? '서버 반영 확인됨' : tripSyncOutcome === 'rejected' ? '서버가 변경을 거절함 · 이 기기에는 저장됨' : '서버 반영 여부 불명확 · 이 기기에는 저장됨'}</Text> : null}
                <Text style={styles.cardDescription}>{(tripSyncMessageTripKey === `${group.id}:${trip.id}` ? tripSyncMessage : '') || (tripSyncLoadingTripKey === `${group.id}:${trip.id}` && tripSyncLoading ? '공유 여행 정보를 동기화하는 중…' : '모임 멤버의 지출·정산·사진과 연결됨')}</Text>
                {tripSyncMessageTripKey === `${group.id}:${trip.id}` && tripSyncMessage ? <SecondaryButton title="다시 동기화" compact onPress={() => { void retryTripSync(); }} disabled={tripSyncLoadingTripKey === `${group.id}:${trip.id}` && tripSyncLoading} /> : null}
              </View>
            ) : null}
            <SectionTitle title="지출 내역" trailing={`${trip.expenses.length}건`} />
            {trip.expenses.length === 0 ? (
              <EmptyCard title="첫 지출을 기록해 보세요" description="지출마다 비용을 나눌 멤버를 다르게 선택할 수 있어요." />
            ) : trip.expenses.map((expense) => {
              const payer = group.members.find((member) => member.id === expense.payerId);
              const participants = group.members.filter((member) => expense.participantIds.includes(member.id));
              return (
                <View key={expense.id} style={styles.expenseCard}>
                  <View style={styles.expenseTop}>
                    <View style={styles.cardMain}>
                      <Text style={styles.cardTitle}>{expense.title}</Text>
                      <Text style={styles.cardDescription}>
                        {payer?.name ?? '알 수 없음'} 결제 · {participants.map((member) => member.name).join(', ')} 부담
                      </Text>
                      <Text style={styles.cardDescription}>
                        등록자: {getExpenseCreatorName(expense.createdByUserId, group.members, remoteMemberAccounts[group.id] ?? {})}
                      </Text>
                    </View>
                    <Text style={styles.expenseAmount}>{money(expense.amount)}</Text>
                  </View>
                  <View style={styles.expenseActions}>
                    <Pressable onPress={() => startEditExpense(expense)} style={styles.expenseActionButton} accessibilityRole="button" accessibilityLabel={`${expense.title} 수정`}>
                      <Text style={styles.expenseActionText}>수정</Text>
                    </Pressable>
                    <Pressable onPress={() => deleteExpense(expense)} style={styles.expenseActionButton} accessibilityRole="button" accessibilityLabel={`${expense.title} 삭제`}>
                      <Text style={styles.expenseDeleteText}>삭제</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </>
        )}

        {(screen === 'add-expense' || screen === 'edit-expense') && group && trip && (
          <>
            <Text style={styles.eyebrow}>{screen === 'edit-expense' ? 'EDIT EXPENSE' : 'NEW EXPENSE'}</Text>
            <Text style={styles.pageTitle}>{screen === 'edit-expense' ? '지출을 수정해요' : '지출을 기록해요'}</Text>
            <Text style={styles.pageDescription}>이번 지출을 실제로 나눌 사람을 선택해 주세요.</Text>
            <Field
              label="무엇을 결제했나요?"
              value={expenseTitle}
              onChangeText={setExpenseTitle}
              placeholder="예: 저녁 식사"
              returnKeyType="next"
              onSubmitEditing={() => expenseAmountInput.current?.focus()}
              inputAccessoryViewID="expense-title-keyboard-action"
              accessoryLabel="다음"
              onAccessoryPress={() => expenseAmountInput.current?.focus()}
            />
            <Text style={styles.fieldLabel}>자주 쓰는 내역</Text>
            <View style={styles.chipWrap}>
              {commonExpenseTitles.map((title) => (
                <ChoiceChip
                  key={title}
                  label={title}
                  selected={expenseTitle === title}
                  onPress={() => setExpenseTitle(title)}
                  checkable
                />
              ))}
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>결제 금액</Text>
              <View style={styles.amountInputRow}>
                <TextInput
                  ref={expenseAmountInput}
                  value={expenseAmount ? new Intl.NumberFormat('ko-KR').format(Number(expenseAmount)) : ''}
                  onChangeText={(value) => setExpenseAmount(value.replace(/[^0-9]/g, ''))}
                  placeholder="금액 입력"
                  placeholderTextColor={colors.muted}
                  keyboardType="number-pad"
                  returnKeyType="done"
                  onSubmitEditing={Keyboard.dismiss}
                  inputAccessoryViewID="expense-amount-keyboard-action"
                  onFocus={() => {
                    setExpenseAmountFocused(true);
                    scrollFocusedInputIntoView(expenseAmountInput.current);
                  }}
                  onBlur={() => setExpenseAmountFocused(false)}
                  style={styles.amountInput}
                  accessibilityLabel="결제 금액, 원 단위"
                />
                <Text style={styles.amountCurrency}>원</Text>
                {Platform.OS === 'android' && expenseAmountFocused ? (
                  <Pressable onPress={Keyboard.dismiss} style={styles.inlineKeyboardDone} accessibilityRole="button">
                    <Text style={styles.inlineKeyboardDoneText}>완료</Text>
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.quickAmountWrap}>
                {[1_000, 5_000, 10_000, 100_000, 200_000].map((amount) => (
                  <Pressable
                    key={amount}
                    onPress={() => addQuickExpenseAmount(amount)}
                    style={styles.quickAmountButton}
                    accessibilityRole="button"
                    accessibilityLabel={`${new Intl.NumberFormat('ko-KR').format(amount)}원 추가`}
                  >
                    <Text style={styles.quickAmountText}>+{new Intl.NumberFormat('ko-KR').format(amount)}원</Text>
                  </Pressable>
                ))}
              </View>
              <KeyboardActionAccessory nativeID="expense-amount-keyboard-action" onPress={Keyboard.dismiss} />
            </View>
            <Text style={styles.fieldLabel}>결제한 사람</Text>
            <View style={styles.chipWrap}>
                {group.members.map((member) => (
                  <ChoiceChip key={member.id} label={member.name} selected={payerId === member.id} onPress={() => { Keyboard.dismiss(); setPayerId(member.id); }} />
              ))}
            </View>
            <Text style={styles.fieldLabel}>비용을 나눌 사람</Text>
            <Text style={styles.fieldHint}>선택한 사람끼리 균등 분할해요. 남는 1원은 모임 멤버 순서로 배분합니다.</Text>
            <View style={styles.chipWrap}>
              {group.members.map((member) => (
                <ChoiceChip
                  key={member.id}
                  label={member.name}
                  selected={participantIds.includes(member.id)}
                  onPress={() => { Keyboard.dismiss(); toggleParticipant(member.id); }}
                  checkable
                />
              ))}
            </View>
            <PrimaryButton title={screen === 'edit-expense' ? '수정 완료' : '지출 저장'} onPress={saveExpense} />
          </>
        )}

        {screen === 'settlement' && group && trip && (
          <>
            <Text style={styles.eyebrow}>TRIP SETTLEMENT</Text>
            <Text style={styles.pageTitle}>정산 결과</Text>
            <Text style={styles.pageDescription}>{trip.name} · 현재 지출 {trip.expenses.length}건 기준</Text>
            <View style={styles.settlementTotal}>
              <Text style={styles.summaryLabel}>여행 총 지출</Text>
              <Text style={styles.summaryAmount}>{money(tripTotal)}</Text>
            </View>
            <View style={styles.settlementStatusCard}>
              <View style={styles.settlementStatusCopy}>
                <SettlementStatusBadge completed={Boolean(trip.settledAt)} />
                <Text style={styles.settlementStatusDescription}>
                  {trip.settledAt
                    ? `완료일 ${new Date(trip.settledAt).toLocaleDateString('ko-KR')} · 지출 추가가 잠겨 있어요.`
                    : '송금을 모두 마친 뒤 정산 완료로 표시해 주세요.'}
                </Text>
              </View>
              <Pressable
                onPress={() => updateSettlementStatus(!trip.settledAt)}
                style={[styles.settlementStatusAction, trip.settledAt && styles.reopenSettlementAction]}
                accessibilityRole="button"
                accessibilityLabel={trip.settledAt ? '정산 다시 열기' : '정산 완료 처리'}
              >
                <Text style={[styles.settlementStatusActionText, trip.settledAt && styles.reopenSettlementActionText]}>
                  {trip.settledAt ? '정산 다시 열기' : '정산 완료 처리'}
                </Text>
              </Pressable>
            </View>
            {(() => {
              const balances = calculateBalances(group.members, trip.expenses);
              const transfers = calculateMinimumTransfers(group.members, balances);
              return (
                <>
                  <SectionTitle title="멤버별 정산" />
                  <View style={styles.balanceCard}>
                    {group.members.map((member, index) => {
                      const balance = balances[member.id] ?? 0;
                      return (
                        <View key={member.id} style={[styles.balanceRow, index === group.members.length - 1 && styles.lastRow]}>
                          <Text style={styles.balanceName}>{member.name}</Text>
                          <Text style={[styles.balanceAmount, balance > 0 ? styles.receive : balance < 0 ? styles.pay : styles.even]}>
                            {balance > 0 ? `받을 돈 ${money(balance)}` : balance < 0 ? `보낼 돈 ${money(-balance)}` : '정산 완료'}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                  <SectionTitle title="송금 방법" />
                  <View style={styles.transferCard}>
                    {transfers.length === 0 ? (
                      <Text style={styles.emptyTransfer}>서로 주고받을 금액이 없습니다.</Text>
                    ) : transfers.map((transfer, index) => {
                      const from = group.members.find((member) => member.id === transfer.fromMemberId);
                      const to = group.members.find((member) => member.id === transfer.toMemberId);
                      return (
                        <View key={`${transfer.fromMemberId}-${transfer.toMemberId}-${index}`} style={styles.transferRow}>
                          <View style={styles.transferNumber}><Text style={styles.transferNumberText}>{index + 1}</Text></View>
                          <Text style={styles.transferText}>
                            <Text style={styles.transferName}>{from?.name}</Text>님이 <Text style={styles.transferName}>{to?.name}</Text>님에게
                          </Text>
                          <Text style={styles.transferAmount}>{money(transfer.amount)}</Text>
                        </View>
                      );
                    })}
                  </View>
                  <Text style={styles.settlementNote}>
                    {trip.settledAt
                      ? '지출을 수정하려면 정산을 다시 열어 주세요.'
                      : '송금 횟수를 줄인 결과예요. 모든 송금이 끝나면 정산 완료로 표시할 수 있어요.'}
                  </Text>
                </>
              );
            })()}
          </>
        )}
      </ScrollView>
      {shouldShowBottomNavigation ? (
        <View style={styles.bottomNavigation} accessibilityRole="tablist">
          {primaryTabs.map((tab) => {
            const selected = activeTab === tab.id;
            return (
              <Pressable
                key={tab.id}
                onPress={() => openTab(tab.id)}
                style={styles.tabItem}
                accessibilityRole="tab"
                accessibilityLabel={tab.label}
                accessibilityState={{ selected }}
              >
                <View style={[styles.tabIconWrap, selected && styles.activeTabIconWrap]}>
                  <NavigationIcon tab={tab.id} active={selected} />
                  {selected ? <View style={styles.activeTabRouteDot} /> : null}
                  {tab.id === 'friends' && (socialData?.requests ?? []).some((request) => request.direction === 'incoming') ? <View style={[styles.navFriendBadge, selected && styles.navFriendBadgeSelected]} /> : null}
                </View>
                <Text style={[styles.tabLabel, selected && styles.activeTabLabel]}>{tab.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function BrandLogo({ editorial = false }: { editorial?: boolean }) {
  if (editorial) {
    return (
      <View style={styles.editorialBrandLockup} accessibilityLabel="모여Go">
        <Image source={require('./assets/moyeogo-route-mark.png')} style={styles.editorialBrandEmblem} resizeMode="contain" />
        <Text style={styles.editorialBrand}><Text>모여</Text><Text style={styles.wordmarkAccent}>Go</Text></Text>
      </View>
    );
  }
  return (
    <View style={styles.brandLockup} accessibilityLabel="모여Go 여행 기록">
      <Image source={require('./assets/moyeogo-route-mark.png')} style={styles.brandMarkImage} resizeMode="contain" />
      <View>
        <Text style={styles.headerBrand}><Text>모여</Text><Text style={styles.wordmarkAccent}>Go</Text></Text>
        <Text style={styles.brandTagline}>TRAVEL TOGETHER</Text>
      </View>
    </View>
  );
}

function NavigationIcon({ tab, active }: { tab: PrimaryTab; active: boolean }) {
  return <Image source={navigationIconSources[tab]} style={[styles.navIcon, active && styles.activeNavIcon]} resizeMode="contain" accessible={false} />;
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  keyboardType = 'default',
  inputRef,
  returnKeyType = 'done',
  onSubmitEditing,
  onFocus,
  inputAccessoryViewID,
  accessoryLabel = '완료',
  onAccessoryPress,
  secureTextEntry = false,
  trailingActionLabel,
  onTrailingActionPress,
  autoCapitalize = 'sentences',
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'number-pad' | 'email-address';
  inputRef?: React.Ref<TextInput>;
  returnKeyType?: 'default' | 'done' | 'next' | 'send' | 'search';
  onSubmitEditing?: () => void;
  onFocus?: () => void;
  inputAccessoryViewID?: string;
  accessoryLabel?: string;
  onAccessoryPress?: () => void;
  secureTextEntry?: boolean;
  trailingActionLabel?: string;
  onTrailingActionPress?: () => void;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={trailingActionLabel ? styles.inputWithAction : undefined}>
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing ?? Keyboard.dismiss}
          inputAccessoryViewID={inputAccessoryViewID}
          onFocus={onFocus}
          multiline={multiline}
          textAlignVertical={multiline ? 'top' : 'center'}
          style={[styles.input, multiline && styles.multilineInput, trailingActionLabel && styles.inputWithActionInput]}
        />
        {trailingActionLabel ? (
          <Pressable
            onPress={onTrailingActionPress}
            style={styles.inputTrailingAction}
            accessibilityRole="button"
            accessibilityLabel={trailingActionLabel === '보기' ? '비밀번호 표시' : '비밀번호 숨기기'}
            hitSlop={8}
          >
            <View style={styles.passwordEyeIcon}>
              <View style={styles.passwordEyePupil} />
              {trailingActionLabel === '보기' ? <View style={styles.passwordEyeSlash} /> : null}
            </View>
          </Pressable>
        ) : null}
      </View>
      {inputAccessoryViewID ? (
        <KeyboardActionAccessory
          nativeID={inputAccessoryViewID}
          label={accessoryLabel}
          onPress={onAccessoryPress ?? Keyboard.dismiss}
        />
      ) : null}
    </View>
  );
}

function PrimaryButton({ title, onPress, compact = false, accountCompact = false, disabled = false }: { title: string; onPress: () => void; compact?: boolean; accountCompact?: boolean; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.primaryButton, compact && styles.compactButton, accountCompact && styles.accountCompactButton, disabled && styles.disabledButton]} accessibilityRole="button" accessibilityState={{ disabled }}>
      <Text style={styles.primaryButtonText}>{title}</Text>
    </Pressable>
  );
}

function SecondaryButton({
  title,
  onPress,
  disabled = false,
  compact = false,
  accountCompact = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  compact?: boolean;
  accountCompact?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.secondaryButton, compact && styles.compactButton, accountCompact && styles.accountCompactButton, disabled && styles.disabledButton]}
      accessibilityRole="button"
    >
      <Text style={[styles.secondaryButtonText, disabled && styles.disabledButtonText]}>{title}</Text>
    </Pressable>
  );
}

function ChoiceChip({
  label,
  selected,
  onPress,
  checkable = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  checkable?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && styles.selectedChip]} accessibilityRole="button">
      <Text style={[styles.chipText, selected && styles.selectedChipText]}>
        {checkable && selected ? '✓ ' : ''}{label}
      </Text>
    </Pressable>
  );
}

function GroupMemberChip({
  member,
  status,
  owner,
  registered,
}: {
  member: Member;
  status: 'pending' | 'active' | 'removed';
  owner: boolean;
  registered: boolean;
}) {
  const memberType = status === 'pending' ? '회원 초대' : status === 'removed' ? '이전 구성원' : registered ? '회원' : '비회원';
  const memberState = status === 'pending' ? '수락 대기' : status === 'removed' ? '탈퇴/제외' : '활성';
  const description = member.name + ', ' + (owner ? '모임장, ' : '') + memberType + ', ' + memberState;
  return <View style={[styles.memberChip, status === 'pending' && styles.memberChipPending, status === 'removed' && styles.memberChipRemoved]} accessibilityRole="text" accessibilityLabel={description}>
    <Text style={styles.memberChipName} numberOfLines={1}>{member.name}</Text>
    {owner ? <Text style={styles.memberChipBadge}>모임장</Text> : null}
    <Text style={styles.memberChipMeta}>{memberType}</Text>
    <Text style={[styles.memberChipMeta, status === 'pending' && styles.memberChipPendingText, status === 'removed' && styles.memberChipRemovedText]}>{memberState}</Text>
  </View>;
}

function SectionTitle({ title, trailing, onRefresh }: { title: string; trailing?: string; onRefresh?: () => void }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {trailing ? <Text style={styles.sectionTrailing}>{trailing}</Text> : null}
      {onRefresh ? <Pressable onPress={onRefresh} style={styles.groupInvitationRefreshButton} accessibilityRole="button" accessibilityLabel="받은 모임 초대 새로고침"><Text style={styles.groupInvitationRefreshIcon} accessible={false}>↻</Text></Pressable> : null}
    </View>
  );
}

function EmptyCard({ title, description }: { title: string; description: string }) {
  return (
    <View style={styles.emptyCard}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDescription}>{description}</Text>
    </View>
  );
}

function DashboardStat({ label, value, unit, compact = false }: { label: string; value: string; unit?: string; compact?: boolean }) {
  return (
    <View style={styles.dashboardStat}>
      <Text style={styles.dashboardStatLabel}>{label}</Text>
      <Text style={[styles.dashboardStatValue, compact && styles.dashboardStatValueCompact]} numberOfLines={1} adjustsFontSizeToFit>
        {value}{unit ? <Text style={styles.dashboardStatUnit}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

function TripRecordCard({ group, trip, onPress }: { group: Group; trip: Trip; onPress: () => void }) {
  const total = trip.expenses.reduce((sum, expense) => sum + expense.amount, 0);
  return (
    <Pressable style={styles.tripRecordCard} onPress={onPress} accessibilityRole="button">
      <View style={styles.tripRecordTop}>
        <View style={styles.tripRecordGroupIcon}><Text style={styles.tripRecordGroupIconText}>{group.name.slice(0, 1)}</Text></View>
        <View style={styles.cardMain}>
          <Text style={styles.tripRecordGroupName}>{group.name}</Text>
          <Text style={styles.tripRecordMemberCount}>멤버 {group.members.length}명</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </View>
      <Text style={styles.tripRecordName}>{trip.name}</Text>
      <Text style={styles.cardDescription}>
        {trip.destination}{trip.detailAddress ? ` · ${trip.detailAddress}` : ''}
      </Text>
      <Text style={styles.tripRecordDate}>{trip.dateRange}</Text>
      <View style={styles.tripRecordFooter}>
        <Text style={styles.tripRecordExpenseCount}>지출 {trip.expenses.length}건</Text>
        <SettlementStatusBadge completed={Boolean(trip.settledAt)} />
        <Text style={styles.tripRecordTotal}>{money(total)}</Text>
      </View>
    </Pressable>
  );
}

function JournalTripRow({ group, trip, fallbackOption, onPress }: { group: Group; trip: Trip; fallbackOption: number; onPress: () => void }) {
  const total = trip.expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const status = getJournalTripStatus(trip);
  const coverPhoto = getTripCoverPhoto(trip.photos, trip.coverPhotoId);
  const statusStyle = status === '정산완료' ? styles.journalStatusSettled : status === '진행중' ? styles.journalStatusInProgress : status === '여행 종료' ? styles.journalStatusEnded : styles.journalStatusPending;
  return (
    <Pressable style={styles.journalTripRow} onPress={onPress} accessibilityRole="button">
      <View style={styles.journalTimeline}>
        <View style={styles.journalTimelineRail} />
        <View style={styles.journalTimelineDot} />
        {coverPhoto ? (
          <Image source={{ uri: coverPhoto.uri }} style={styles.journalTripThumbnail} resizeMode="cover" />
        ) : (
          <TripFallbackCover option={fallbackOption} style={styles.journalTripThumbnail} />
        )}
      </View>
      <View style={styles.journalTripCopy}>
        <View style={styles.journalTripTopline}>
          <Text style={styles.journalTripDate} numberOfLines={1}>{formatJournalDate(trip.dateRange)}</Text>
          <Text style={[styles.journalTripStatus, statusStyle]}>{status}</Text>
        </View>
        <View style={styles.journalTripMainline}>
          <View style={styles.journalTripTitleBlock}>
            <Text style={styles.journalTripName} numberOfLines={1}>{trip.name}</Text>
            <Text style={styles.journalTripNote} numberOfLines={1}>
              {trip.destination}{trip.detailAddress ? ` · ${trip.detailAddress}` : ''}{group.members.length ? ` · ${group.members.length}명` : ''}
            </Text>
          </View>
          <View style={styles.journalTripAmountBlock}>
            <Text style={styles.journalTripAmount}>{money(total)}</Text>
            <Text style={styles.journalTripPeople}>{group.members.length}명</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function SettlementStatusBadge({ completed }: { completed: boolean }) {
  return (
    <View style={[styles.settlementStatusBadge, completed ? styles.completedBadge : styles.openBadge]}>
      <View style={[styles.settlementStatusDot, completed ? styles.completedDot : styles.openDot]} />
      <Text style={[styles.settlementStatusBadgeText, completed ? styles.completedBadgeText : styles.openBadgeText]}>
        {completed ? '정산 완료' : '정산 미완료'}
      </Text>
    </View>
  );
}

function TripPhaseBadge({ phase }: { phase: 'planned' | 'inProgress' | 'ended' }) {
  const label = phase === 'planned' ? '여행 예정' : phase === 'inProgress' ? '여행 중' : '여행 종료';
  const phaseStyle = phase === 'planned' ? styles.tripPhasePlanned : phase === 'inProgress' ? styles.tripPhaseActive : styles.tripPhaseEnded;
  return <View style={[styles.tripPhaseBadge, phaseStyle]}><Text style={styles.tripPhaseBadgeText}>{label}</Text></View>;
}

const photoFadeOpacities = Array.from({ length: 18 }, (_, index) => Number((0.9 * (1 - index / 18) ** 1.7).toFixed(2)));

function PhotoCloudFade({ edge }: { edge: 'top' | 'bottom' }) {
  const puffs: { left: `${number}%`; width: `${number}%`; height: number; offset: number; opacity: number }[] = [
    { left: '-8%', width: '32%', height: 25, offset: 16, opacity: 0.34 },
    { left: '18%', width: '28%', height: 20, offset: 23, opacity: 0.28 },
    { left: '44%', width: '35%', height: 27, offset: 15, opacity: 0.32 },
    { left: '75%', width: '34%', height: 21, offset: 22, opacity: 0.3 },
  ];
  return (
    <View pointerEvents="none" style={[styles.photoCloudFade, edge === 'top' ? styles.photoCloudTop : styles.photoCloudBottom]}>
      {photoFadeOpacities.map((opacity, index) => (
        <View key={`${edge}-fade-${index}`} style={[styles.photoCloudBand, { opacity, [edge]: index * 2.2 }]} />
      ))}
      {puffs.map((puff, index) => (
        <View
          key={`${edge}-cloud-${index}`}
          style={[styles.photoCloudPuff, { left: puff.left, width: puff.width, height: puff.height, opacity: puff.opacity, [edge]: puff.offset }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: Platform.OS === 'android' ? (NativeStatusBar.currentHeight ?? 0) : 0,
  },
  header: { height: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22 },
  headerActions: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 12 },
  authGateHeader: { height: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 26 },
  authGateContent: { flexGrow: 1, paddingHorizontal: 26, paddingTop: 26, paddingBottom: 30, justifyContent: 'center' },
  friendIntroContent: { flex: 1, justifyContent: 'center', paddingHorizontal: 26, paddingBottom: 60, gap: 10 },
  friendIntroHint: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 16 },
  authHeadline: { color: colors.ink, fontFamily: 'serif', fontSize: 29, lineHeight: 39, letterSpacing: -0.5, marginBottom: 10 },
  authDescription: { color: colors.muted, fontSize: 14, lineHeight: 21, marginBottom: 26 },
  headerAccountButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerBellButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  introBellButton: { marginLeft: 'auto' },
  headerBellBadge: { position: 'absolute', top: 2, right: 0, minWidth: 17, height: 17, paddingHorizontal: 3, borderRadius: 9, backgroundColor: '#B74D42', alignItems: 'center', justifyContent: 'center' },
  headerBellBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  headerAvatar: { width: 36, height: 36, borderRadius: 18, overflow: 'hidden', backgroundColor: colors.primaryPale, alignItems: 'center', justifyContent: 'center' },
  headerAvatarImage: { width: 36, height: 36 },
  headerAvatarText: { color: colors.primaryDark, fontSize: 13, fontWeight: '800' },
  bellIcon: { width: 20, height: 25, alignItems: 'center', justifyContent: 'center' },
  bellBody: { width: 14, height: 15, borderWidth: 1.5, borderColor: colors.ink, borderTopLeftRadius: 8, borderTopRightRadius: 8, borderBottomLeftRadius: 3, borderBottomRightRadius: 3 },
  bellClapper: { position: 'absolute', width: 4, height: 3, borderRadius: 2, bottom: 2, backgroundColor: colors.ink },
  notificationCard: { backgroundColor: colors.surface, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, marginTop: 10 },
  notificationEntry: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 10 },
  notificationCopy: { flex: 1, gap: 4 },
  notificationTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  notificationTitle: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  notificationUnreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#B74D42' },
  notificationBody: { color: colors.ink, fontSize: 13, lineHeight: 20 },
  notificationDate: { color: colors.muted, fontSize: 11 },
  notificationActions: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 9 },
  notificationStatus: { color: colors.muted, fontSize: 12, paddingTop: 6 },
  editorialBrandLockup: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  editorialBrand: { color: colors.ink, fontFamily: Platform.select({ ios: 'AvenirNext-DemiBold', android: 'sans-serif-condensed', default: 'sans-serif' }), fontSize: 27, lineHeight: 35, fontWeight: '700', letterSpacing: -1.15 },
  editorialBrandEmblem: { width: 33, height: 33 },
  wordmarkAccent: { color: '#527B7D', fontWeight: '800', letterSpacing: -0.8 },
  brandLockup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  brandMarkImage: { width: 34, height: 34 },
  headerBrand: { color: colors.ink, fontFamily: Platform.select({ ios: 'AvenirNext-DemiBold', android: 'sans-serif-condensed', default: 'sans-serif' }), fontSize: 20, lineHeight: 24, fontWeight: '800', letterSpacing: -0.8 },
  brandTagline: { color: colors.muted, fontSize: 8, lineHeight: 12, fontWeight: '700', letterSpacing: 1.05 },
  headerContext: { color: colors.ink, fontSize: 14, fontWeight: '700', marginLeft: 10, maxWidth: '55%' },
  backButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: colors.surface },
  backText: { color: colors.ink, fontSize: 28, lineHeight: 30, marginTop: -3 },
  content: { paddingHorizontal: 22, paddingTop: 14, paddingBottom: 32 },
  screenTitle: { color: colors.ink, fontFamily: 'serif', fontSize: 25, lineHeight: 33, marginBottom: 9 },
  screenDescription: { color: colors.muted, fontSize: 13, lineHeight: 20, marginBottom: 22 },
  tripSettlementShortcut: { minHeight: 65, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 10, marginBottom: 18 },
  tripSettlementShortcutTitle: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  tripSettlementShortcutDescription: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 3 },
  accountProfileCard: { minHeight: 96, flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: 15, marginBottom: 20 },
  accountAvatar: { width: 58, height: 58, borderRadius: 29, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryPale },
  accountAvatarImage: { width: 58, height: 58 },
  accountAvatarEditBadge: { position: 'absolute', right: 0, bottom: 0, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, borderWidth: 1.5, borderColor: colors.surface },
  accountAvatarEditText: { color: '#FFFFFF', fontSize: 14, lineHeight: 16, fontWeight: '700', marginTop: -1 },
  accountAvatarText: { color: colors.primaryDark, fontFamily: 'serif', fontSize: 25, fontWeight: '700' },
  accountIdentity: { flex: 1, minWidth: 0 },
  accountProfileName: { color: colors.ink, fontSize: 19, fontWeight: '700', marginBottom: 4 },
  accountEmail: { color: colors.muted, fontSize: 12 },
  accountPhotoActions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 5 },
  accountPhotoAction: { minHeight: 48, justifyContent: 'center' },
  accountPhotoActionText: { color: colors.primaryDark, fontSize: 11, fontWeight: '700' },
  accountPhotoRemoveText: { color: colors.muted, fontSize: 11 },
  accountPhotoHint: { color: colors.muted, fontSize: 10, marginTop: 2 },
  accountSectionHeading: { color: colors.ink, fontSize: 14, fontWeight: '700', marginBottom: 8, marginLeft: 2 },
  accountSettingsCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 13, padding: 14, marginBottom: 17 },
  accountButtonRow: { flexDirection: 'row', gap: 8, marginTop: 0 },
  accountButtonHalf: { flex: 1 },
  accountRowTitle: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  accountRowDescription: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  friendCodeShareRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 12 },
  friendCodeValue: { backgroundColor: '#F6F2E8', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6 },
  accountDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginTop: 15, marginBottom: 2 },
  accountNavigationRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  accountChevron: { color: colors.muted, fontSize: 24, marginRight: 5 },
  accountToggleRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  accountToggleCopy: { flex: 1 },
  logoutButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 12, marginTop: 1 },
  logoutButtonText: { color: colors.primaryDark, fontSize: 14, fontWeight: '700' },
  accountCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 16, marginBottom: 14 },
  friendCodeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 8, marginBottom: 2 },
  friendCodeText: { color: colors.primaryDark, fontSize: 13, fontWeight: '700', letterSpacing: 0.55 },
  helperText: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 5, marginBottom: 10 },
  formError: { color: colors.coral, fontSize: 12, lineHeight: 18, marginTop: -7, marginBottom: 12 },
  formSuccess: { color: '#4E755E', fontSize: 12, lineHeight: 18, marginTop: 2, marginBottom: 12 },
  nicknameCheckPending: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 2, marginBottom: 12 },
  nicknameCheckError: { color: colors.coral, fontSize: 12, lineHeight: 18, marginTop: 7, marginBottom: 12 },
  settingToggleRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 5 },
  settingToggleLabel: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  settingToggle: { width: 46, height: 27, borderRadius: 14, backgroundColor: '#D9D3C8', padding: 3, justifyContent: 'center' },
  settingToggleOn: { backgroundColor: colors.primary },
  settingToggleKnob: { width: 21, height: 21, borderRadius: 11, backgroundColor: '#FFFFFF' },
  settingToggleKnobOn: { alignSelf: 'flex-end' },
  friendResultCard: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, paddingVertical: 8 },
  friendAddAction: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.primaryPale, marginBottom: 15 },
  friendAddActionText: { color: colors.primaryDark, fontSize: 14, fontWeight: '700' },
  friendMyIdRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, marginBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  friendMyIdText: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  friendMyIdShare: { color: colors.primaryDark, fontSize: 12, fontWeight: '700' },
  friendTabs: { flexDirection: 'row', gap: 5, marginBottom: 13 },
  friendTab: { flex: 1, minHeight: 48, justifyContent: 'center', alignItems: 'center', borderBottomWidth: 2, borderBottomColor: colors.line },
  friendTabSelected: { borderBottomColor: colors.primary },
  friendTabText: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  friendTabTextSelected: { color: colors.primaryDark, fontWeight: '800' },
  friendEmptyTitle: { color: colors.ink, fontSize: 16, fontWeight: '700', marginBottom: 6 },
  friendFeedback: { color: colors.primaryDark, fontSize: 12, lineHeight: 18, marginBottom: 10 },
  friendName: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  requestStatus: { color: colors.muted, fontSize: 11 },
  rejectAction: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 8 },
  rejectActionText: { color: colors.muted, fontSize: 12 },
  authModeSwitch: { minHeight: 48, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 2 },
  authModeSwitchLabel: { color: colors.muted, fontSize: 13 },
  authModeSwitchAction: { color: colors.primaryDark, fontSize: 13, fontWeight: '700' },
  disabledText: { opacity: 0.45 },
  emailComposer: { minHeight: 48, flexDirection: 'row', alignItems: 'center', borderRadius: 5, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, paddingHorizontal: 15 },
  emailLocalInput: { minWidth: 40, flex: 1, height: 48, color: colors.ink, fontSize: 14, paddingVertical: 0 },
  emailAtSign: { color: colors.muted, fontSize: 15, marginHorizontal: 6 },
  emailDomainButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 4 },
  emailDomainText: { color: colors.ink, fontSize: 13 },
  emailDomainChevron: { color: colors.muted, fontSize: 16 },
  emailCustomDomainInput: { width: 112, height: 48, color: colors.ink, fontSize: 14, paddingVertical: 0 },
  emailDomainOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 9 },
  emailDomainOption: { minHeight: 48, justifyContent: 'center', borderRadius: 24, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 11, backgroundColor: colors.surface },
  emailDomainOptionSelected: { backgroundColor: '#EEE5D5', borderColor: colors.primary },
  emailDomainOptionText: { color: colors.muted, fontSize: 12 },
  emailDomainOptionTextSelected: { color: colors.primaryDark, fontWeight: '700' },
  passwordRequirements: { gap: 6, marginTop: -6, marginBottom: 14 },
  compactPasswordRequirements: { gap: 4, marginTop: -5, marginBottom: 10 },
  passwordRequirementRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  passwordRequirementMark: { width: 16, color: colors.muted, fontSize: 13, textAlign: 'center' },
  passwordRequirementText: { color: colors.muted, fontSize: 12 },
  passwordRequirementMet: { color: colors.primaryDark, fontWeight: '700' },
  passwordMatchHint: { color: colors.coral, fontSize: 12, marginTop: -7, marginBottom: 12 },
  authOtpHint: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 3, marginBottom: 14 },
  socialButtonRow: { flexDirection: 'column', gap: 10 },
  socialButton: { width: '100%', minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 16 },
  kakaoButton: { backgroundColor: '#FEE500', borderColor: '#FEE500' },
  googleButton: { backgroundColor: colors.surface },
  socialMark: { position: 'absolute', left: 18, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  kakaoMark: { backgroundColor: 'rgba(57, 32, 32, 0.10)' },
  kakaoMarkText: { color: '#392020', fontSize: 15, fontWeight: '900' },
  googleMark: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E6E0D5' },
  googleMarkText: { color: '#4285F4', fontSize: 16, fontWeight: '800' },
  socialButtonText: { color: colors.ink, fontSize: 14, fontWeight: '700', textAlign: 'center' },
  disabledSocialButton: { opacity: 0.55 },
  authDivider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16, marginBottom: 14 },
  authDividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
  authDividerLabel: { color: colors.muted, fontSize: 12 },
  authSpinner: { marginTop: 12, marginBottom: 14 },
  authMessage: { color: colors.primaryDark, fontSize: 13, lineHeight: 19, marginTop: 10, marginBottom: 15 },
  accountFootnote: { color: colors.muted, fontSize: 11, textAlign: 'center', marginTop: 8 },
  journalContent: { paddingHorizontal: 24, paddingTop: 10, paddingBottom: 28 },
  journalIntro: { marginBottom: 14 },
  journalHeadline: {
    color: '#20221F',
    fontFamily: Platform.select({ ios: 'AvenirNext-DemiBold', android: 'sans-serif-condensed', default: 'sans-serif' }),
    fontSize: 27,
    fontWeight: '700',
    lineHeight: 35,
    letterSpacing: -0.8,
  },
  journalHeadlineAccent: { color: '#527B7D', fontWeight: '800', letterSpacing: -0.5 },
  journalIntroFooter: { minHeight: 54, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 4 },
  journalCaption: { color: '#625E56', fontFamily: 'serif', fontSize: 12, lineHeight: 17 },
  journalTripStamp: { maxWidth: '52%', alignItems: 'flex-end', borderRightWidth: 2, borderRightColor: '#B84731', paddingRight: 8, paddingBottom: 2 },
  journalTripStampDate: { color: colors.muted, fontSize: 9 },
  journalTripStampPlace: { color: colors.primaryDark, fontFamily: Platform.select({ ios: 'Snell Roundhand', android: 'cursive', default: 'serif' }), fontSize: 23, fontStyle: 'italic', letterSpacing: 0.3, marginTop: 1 },
  journalHero: { height: 210, overflow: 'hidden', position: 'relative', marginHorizontal: -24, marginBottom: 15, backgroundColor: '#D8E2DF' },
  journalHeroImage: { ...StyleSheet.absoluteFill, width: undefined, height: undefined },
  photoCloudFade: { position: 'absolute', left: 0, right: 0, height: 42, overflow: 'hidden', zIndex: 3 },
  photoCloudTop: { top: 0 },
  photoCloudBottom: { bottom: 0 },
  photoCloudBand: { position: 'absolute', left: 0, right: 0, height: 2.5, backgroundColor: colors.background },
  photoCloudPuff: { position: 'absolute', borderRadius: 100, backgroundColor: colors.background },
  journalHeroActionRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: -9, marginBottom: 12, paddingRight: 3 },
  journalHeroActionText: { color: colors.primaryDark, fontSize: 12, fontWeight: '700' },
  journalHeroActionArrow: { color: colors.primary, fontSize: 17 },
  journalSectionHeader: { minHeight: 35, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 1, marginBottom: 2 },
  journalSectionTitle: { color: '#20221F', fontFamily: 'serif', fontSize: 17 },
  journalSeeAll: { color: colors.muted, fontSize: 11 },
  journalTripRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#D8D0C3', paddingVertical: 6 },
  journalTimeline: { width: 92, minHeight: 62, justifyContent: 'center', paddingLeft: 18, marginRight: 9 },
  journalTimelineRail: { position: 'absolute', left: 5, top: 0, bottom: 0, width: 1, backgroundColor: '#B84731' },
  journalTimelineDot: { position: 'absolute', left: 2, top: 28, width: 8, height: 8, borderRadius: 4, borderWidth: 1.5, borderColor: '#B84731', backgroundColor: colors.background, zIndex: 1 },
  journalTripThumbnail: { width: 72, height: 60, borderRadius: 5, overflow: 'hidden', position: 'relative' },
  journalTripCopy: { flex: 1, minWidth: 0, paddingVertical: 3 },
  journalTripTopline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 5 },
  journalTripDate: { color: colors.muted, fontSize: 9, flex: 1 },
  journalTripStatus: { fontSize: 9, fontWeight: '700' },
  journalStatusSettled: { color: '#27634D' },
  journalStatusInProgress: { color: '#B84731' },
  journalStatusEnded: { color: '#625E56' },
  journalStatusPending: { color: '#A36A30' },
  journalTripMainline: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 3 },
  journalTripTitleBlock: { flex: 1, minWidth: 0, marginRight: 8 },
  journalTripName: { color: '#20221F', fontFamily: 'serif', fontSize: 18, lineHeight: 22 },
  journalTripNote: { color: colors.muted, fontSize: 10, marginTop: 1 },
  journalTripAmountBlock: { alignItems: 'flex-end' },
  journalTripAmount: { color: '#292923', fontFamily: 'serif', fontSize: 12 },
  journalTripPeople: { color: colors.muted, fontSize: 10, marginTop: 2 },
  journalLocalNote: { color: colors.muted, fontSize: 10, textAlign: 'center', marginTop: 18 },
  bottomNavigation: { minHeight: 78, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, paddingHorizontal: 5, paddingTop: 5, paddingBottom: Platform.OS === 'ios' ? 12 : 6 },
  tabItem: { flex: 1, minHeight: 60, alignItems: 'center', justifyContent: 'center' },
  tabIconWrap: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  activeTabIconWrap: { borderWidth: 2, borderColor: '#527B7D' },
  activeTabRouteDot: { position: 'absolute', width: 10, height: 10, borderRadius: 5, top: -3, right: -3, backgroundColor: colors.primary, borderWidth: 2, borderColor: colors.surface },
  navIcon: { width: 25, height: 25, tintColor: '#527B7D' },
  activeNavIcon: { width: 21, height: 21, tintColor: colors.primary },
  navFriendBadge: { position: 'absolute', width: 8, height: 8, borderRadius: 4, top: -1, right: -1, backgroundColor: colors.primary, borderWidth: 1, borderColor: colors.surface },
  navFriendBadgeSelected: { left: -2, right: undefined },
  tabLabel: { color: '#527B7D', fontSize: 11, fontWeight: '500', marginTop: 2 },
  activeTabLabel: { color: colors.primary, fontWeight: '700' },
  eyebrow: { color: colors.primary, fontSize: 10, fontWeight: '700', letterSpacing: 1.8, marginBottom: 10 },
  pageTitle: { color: '#20221F', fontFamily: 'serif', fontSize: 29, lineHeight: 38, fontWeight: '400', letterSpacing: -0.3 },
  pageDescription: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 9, marginBottom: 22 },
  primaryButton: { minHeight: 48, backgroundColor: colors.primary, borderRadius: 6, alignItems: 'center', justifyContent: 'center', marginTop: 4, marginBottom: 20, paddingHorizontal: 18 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  secondaryButton: { minHeight: 48, borderColor: colors.primary, borderWidth: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center', marginTop: 4, marginBottom: 20, paddingHorizontal: 18 },
  secondaryButtonText: { color: colors.primaryDark, fontSize: 14, fontWeight: '700' },
  compactButton: { flex: 1, marginBottom: 0 },
  accountCompactButton: { flex: 0, marginTop: 0, marginBottom: 0 },
  disabledButton: { borderColor: colors.line, backgroundColor: '#F0F1EC' },
  disabledButtonText: { color: '#A7ADA4' },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, marginBottom: 12, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  sectionTitle: { color: '#20221F', fontFamily: 'serif', fontSize: 18, fontWeight: '400' },
  sectionTrailing: { color: colors.muted, fontSize: 12, marginLeft: 8 },
  groupCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'transparent', borderRadius: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line, paddingHorizontal: 3, paddingVertical: 13, marginBottom: 2 },
  groupInvitationRefreshButton: { width: 44, height: 44, marginLeft: 'auto', alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  groupInvitationRefreshIcon: { color: colors.muted, fontSize: 21, lineHeight: 26 },
  groupInvitationCard: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line, paddingVertical: 12 },
  groupInvitationEmpty: { color: colors.muted, fontSize: 12, paddingVertical: 11 },
  groupActivityStatus: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  groupActivityEmpty: { color: colors.muted, fontSize: 13, paddingVertical: 13 },
  groupActivityRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  groupActivityDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5, backgroundColor: colors.primary },
  groupActivityContent: { flex: 1 },
  groupActivityLabel: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  groupActivityExpense: { color: colors.ink, fontSize: 13, lineHeight: 19, marginTop: 4 },
  groupActivityMeta: { color: colors.muted, fontSize: 11, marginTop: 5 },
  groupActivityMore: { minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  groupActivityMoreText: { color: colors.primaryDark, fontSize: 13, fontWeight: '700' },
  groupInvitationAccept: { minWidth: 72, minHeight: 44, borderWidth: 1, borderColor: colors.primary, borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  groupInvitationAcceptText: { color: colors.primaryDark, fontSize: 13, fontWeight: '700' },
  memberChipFlow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 },
  memberChip: { maxWidth: '100%', minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.line, borderRadius: 20, backgroundColor: colors.surface, paddingHorizontal: 10, paddingVertical: 6 },
  memberChipPending: { borderColor: colors.primary, backgroundColor: colors.primaryPale },
  memberChipRemoved: { borderColor: colors.line, backgroundColor: colors.background },
  memberChipName: { maxWidth: 150, color: colors.ink, fontSize: 12, fontWeight: '700', flexShrink: 1 },
  memberChipBadge: { color: colors.primaryDark, fontSize: 10, fontWeight: '800' },
  memberChipMeta: { color: colors.muted, fontSize: 10, fontWeight: '600' },
  memberChipPendingText: { color: colors.primaryDark, fontWeight: '800' },
  memberChipRemovedText: { color: colors.muted, fontWeight: '800' },
  homeStatsRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  homeStat: { flex: 1, minWidth: 0, minHeight: 76, borderRadius: 5, backgroundColor: colors.primaryPale, paddingHorizontal: 15, paddingVertical: 13, justifyContent: 'center' },
  homeStatLabel: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  homeStatValue: { color: colors.primaryDark, fontSize: 18, fontWeight: '800', marginTop: 7 },
  dashboardStatsRow: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  dashboardStat: { flex: 1, minWidth: 0, minHeight: 80, borderRadius: 5, backgroundColor: colors.primaryPale, paddingHorizontal: 12, paddingVertical: 13, justifyContent: 'center' },
  dashboardStatLabel: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  dashboardStatValue: { color: colors.primaryDark, fontSize: 19, fontWeight: '800', marginTop: 8 },
  dashboardStatValueCompact: { fontSize: 15 },
  dashboardStatUnit: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  homeExpenseRow: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: 'transparent', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line, borderRadius: 0, paddingVertical: 12, marginBottom: 1 },
  homeExpenseIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primaryPale, alignItems: 'center', justifyContent: 'center' },
  homeExpenseIconText: { color: colors.primaryDark, fontSize: 15, fontWeight: '800' },
  homeExpenseAmount: { color: colors.ink, fontSize: 12, fontWeight: '800' },
  groupIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primaryPale, alignItems: 'center', justifyContent: 'center', marginRight: 13 },
  groupIconText: { color: colors.primaryDark, fontFamily: 'serif', fontSize: 19, fontWeight: '400' },
  cardMain: { flex: 1 },
  cardTitle: { color: colors.ink, fontFamily: 'serif', fontSize: 17, fontWeight: '400' },
  cardDescription: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 5 },
  chevron: { color: '#A1A89F', fontSize: 24, marginLeft: 10 },
  tripCard: { backgroundColor: 'transparent', borderRadius: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line, paddingHorizontal: 3, paddingVertical: 14, marginBottom: 2 },
  tripRecordCard: { backgroundColor: 'transparent', borderRadius: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line, paddingHorizontal: 3, paddingVertical: 14, marginBottom: 2 },
  tripRecordTop: { flexDirection: 'row', alignItems: 'center' },
  tripRecordGroupIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primaryPale, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  tripRecordGroupIconText: { color: colors.primaryDark, fontFamily: 'serif', fontSize: 14, fontWeight: '400' },
  tripRecordGroupName: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  tripRecordMemberCount: { color: colors.muted, fontSize: 10, marginTop: 2 },
  tripRecordName: { color: colors.ink, fontFamily: 'serif', fontSize: 20, fontWeight: '400', marginTop: 14 },
  tripRecordDate: { color: colors.muted, fontSize: 11, marginTop: 5 },
  tripRecordFooter: { minHeight: 38, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.line, marginTop: 13, paddingTop: 10 },
  tripRecordExpenseCount: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  tripRecordTotal: { color: colors.ink, fontFamily: 'serif', fontSize: 14, fontWeight: '400' },
  settlementStatusBadge: { minHeight: 24, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', borderRadius: 3, paddingHorizontal: 9, gap: 5 },
  completedBadge: { backgroundColor: colors.greenPale },
  openBadge: { backgroundColor: '#FFF0E8' },
  settlementStatusDot: { width: 6, height: 6, borderRadius: 3 },
  completedDot: { backgroundColor: colors.green },
  openDot: { backgroundColor: colors.orange },
  settlementStatusBadgeText: { fontSize: 10, fontWeight: '700' },
  completedBadgeText: { color: colors.greenDark },
  openBadgeText: { color: colors.orange },
  tripRecordTrailing: { flexDirection: 'row', alignItems: 'center' },
  settlementTripTitle: { flex: 1, marginRight: 8 },
  tripCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tripDday: { alignSelf: 'flex-start', color: colors.primaryDark, fontSize: 11, fontWeight: '700', marginTop: 6 },
  tripAmount: { color: colors.primaryDark, fontSize: 12, fontWeight: '700', marginTop: 13 },
  mapFeatureCard: { alignItems: 'center', backgroundColor: '#EFE8DA', borderRadius: 5, paddingHorizontal: 22, paddingVertical: 27, marginBottom: 20 },
  mapFeatureIcon: { width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryPale, marginBottom: 14 },
  mapFeatureIconText: { color: colors.primaryDark, fontSize: 34, fontWeight: '700' },
  mapFeatureTitle: { color: colors.ink, fontFamily: 'serif', fontSize: 19, fontWeight: '400', textAlign: 'center' },
  mapFeatureDescription: { color: colors.muted, fontSize: 12, lineHeight: 19, textAlign: 'center', marginTop: 8 },
  mapCanvas: { height: 290, overflow: 'hidden', borderRadius: 10, backgroundColor: '#E7E3D9', marginBottom: 10, position: 'relative' },
  mapView: { flex: 1 },
  mapEmptyOverlay: { position: 'absolute', alignSelf: 'center', top: '42%', maxWidth: '78%', paddingHorizontal: 15, paddingVertical: 11, borderRadius: 10, backgroundColor: 'rgba(255,252,245,0.94)', alignItems: 'center' },
  mapEmptyOverlayTitle: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  mapEmptyOverlayText: { color: colors.muted, fontSize: 10, textAlign: 'center', marginTop: 3 },
  mapPrivacyNote: { color: colors.muted, fontSize: 10, lineHeight: 15, marginBottom: 12 },
  mapPhotoThumb: { width: 46, height: 46, borderRadius: 6, backgroundColor: colors.line, marginRight: 10 },
  mapPhotoCoordinates: { color: colors.primaryDark, fontSize: 10, marginTop: 3 },
  comingSoonBadge: { backgroundColor: colors.primaryPale, borderRadius: 3, paddingHorizontal: 12, paddingVertical: 7, marginTop: 15 },
  comingSoonText: { color: colors.primaryDark, fontSize: 11, fontWeight: '700' },
  destinationRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', backgroundColor: 'transparent', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line, paddingHorizontal: 3, paddingVertical: 11, marginBottom: 2 },
  destinationPin: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primaryPale, alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  destinationPinText: { color: colors.primaryDark, fontSize: 21, fontWeight: '700' },
  settlementRecordCard: { backgroundColor: 'transparent', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line, paddingHorizontal: 3, paddingVertical: 14, marginBottom: 2 },
  settlementRecordSummary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 3 },
  emptyCard: { backgroundColor: '#EFE8DA', borderWidth: 1, borderColor: '#E1D7C6', borderRadius: 5, paddingVertical: 25, paddingHorizontal: 20, alignItems: 'center', marginBottom: 16 },
  emptyTitle: { color: colors.ink, fontSize: 14, fontWeight: '700', textAlign: 'center' },
  emptyDescription: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 7 },
  field: { marginBottom: 12 },
  fieldLabel: { color: colors.ink, fontSize: 13, fontWeight: '700', marginBottom: 6, marginTop: 2 },
  fieldHint: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: -3, marginBottom: 10 },
  input: { minHeight: 48, borderRadius: 5, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, paddingHorizontal: 15, color: colors.ink, fontSize: 14 },
  inputWithAction: { position: 'relative', justifyContent: 'center' },
  inputWithActionInput: { paddingRight: 68 },
  inputTrailingAction: { position: 'absolute', right: 1, top: 1, bottom: 1, width: 46, alignItems: 'center', justifyContent: 'center' },
  passwordEyeIcon: { width: 20, height: 14, borderWidth: 1.5, borderColor: colors.muted, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  passwordEyePupil: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.muted },
  passwordEyeSlash: { position: 'absolute', width: 24, height: 1.5, backgroundColor: colors.muted, transform: [{ rotate: '45deg' }] },
  amountInputRow: { minHeight: 48, borderRadius: 5, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center' },
  amountInput: { flex: 1, minHeight: 48, paddingVertical: 0, color: colors.ink, fontSize: 17, fontWeight: '700' },
  amountCurrency: { color: colors.ink, fontSize: 15, fontWeight: '700', marginLeft: 8 },
  inlineKeyboardDone: { minHeight: 48, paddingHorizontal: 8, justifyContent: 'center' },
  inlineKeyboardDoneText: { color: colors.primaryDark, fontSize: 13, fontWeight: '700' },
  quickAmountWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  quickAmountButton: { minWidth: '30%', minHeight: 48, flexGrow: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, paddingHorizontal: 9 },
  quickAmountText: { color: colors.primaryDark, fontSize: 12, fontWeight: '700' },
  multilineInput: { minHeight: 100, paddingTop: 14 },
  memberEntryRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 15 },
  groupFriendPicker: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 5, marginBottom: 16 },
  groupFriendChoiceRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  groupFriendChoiceRowSelected: { backgroundColor: colors.primaryPale },
  groupFriendCheckbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  groupFriendCheckboxSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  groupFriendCheckboxMark: { color: '#FFFFFF', fontSize: 13, lineHeight: 16, fontWeight: '800' },
  groupFriendChoiceName: { flex: 1, color: colors.ink, fontSize: 13, fontWeight: '600' },
  groupFriendAddedLabel: { color: colors.primaryDark, fontSize: 11, fontWeight: '700' },
  groupFriendPickerHint: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 8, marginBottom: 8 },
  groupFriendAddButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryPale, borderRadius: 7, marginBottom: 6, paddingHorizontal: 12 },
  groupFriendAddButtonText: { color: colors.primaryDark, fontSize: 14, fontWeight: '700' },
  groupOwnerMemberPreview: { minHeight: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, marginTop: -4, marginBottom: 20, borderRadius: 12, backgroundColor: colors.primaryPale },
  groupOwnerBadge: { width: 25, height: 25, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginRight: 10, backgroundColor: colors.primary },
  groupOwnerBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  groupOwnerMemberName: { flex: 1, color: colors.ink, fontSize: 14, fontWeight: '700' },
  groupOwnerMemberHint: { color: colors.primaryDark, fontSize: 11, fontWeight: '700' },
  groupTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  groupTitleText: { flex: 1 },
  memberEntryInput: { flex: 1 },
  editMemberInput: { flex: 1, marginVertical: 4, minWidth: 0 },
  memberAddButton: { minWidth: 56, minHeight: 48, borderRadius: 7, backgroundColor: colors.primaryPale, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  memberAddButtonText: { color: colors.primaryDark, fontSize: 14, fontWeight: '800' },
  memberList: { backgroundColor: 'transparent', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, borderRadius: 0, paddingHorizontal: 4, marginBottom: 19 },
  memberListItem: { minHeight: 54, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  memberListNumber: { width: 27, height: 27, borderRadius: 14, backgroundColor: colors.primaryPale, alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  memberListNumberText: { color: colors.primaryDark, fontSize: 11, fontWeight: '800' },
  memberListName: { flex: 1, color: colors.ink, fontSize: 14, fontWeight: '700' },
  memberRemoveButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17 },
  memberRemoveText: { color: colors.muted, fontSize: 23, lineHeight: 26 },
  memberHint: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: -3, marginBottom: 19 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  chip: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 4, paddingHorizontal: 15, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  selectedChip: { backgroundColor: colors.primaryPale, borderColor: colors.primary },
  chipText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  selectedChipText: { color: colors.primaryDark },
  tripHero: { backgroundColor: 'transparent', borderRadius: 0, paddingHorizontal: 0, paddingVertical: 10, marginBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  tripHeadingRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  tripHeadingText: { flex: 1 },
  editTripButton: { minWidth: 52, minHeight: 48, marginTop: 2, paddingHorizontal: 12, borderRadius: 24, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  editTripButtonText: { color: colors.primaryDark, fontSize: 12, fontWeight: '700' },
  deleteGroupAction: { minHeight: 48, marginTop: 10, alignItems: 'center', justifyContent: 'center' },
  deleteGroupActionText: { color: '#B84731', fontSize: 13, fontWeight: '700' },
  heroDivider: { height: 1, backgroundColor: colors.line, marginVertical: 17 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel: { color: colors.muted, fontSize: 13 },
  summaryAmount: { color: colors.ink, fontSize: 20, fontWeight: '800' },
  treasurerText: { color: colors.muted, fontSize: 12, marginTop: 10 },
  tripStatusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 6, flexWrap: 'wrap' },
  tripPhaseBadge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 12 },
  tripPhasePlanned: { backgroundColor: '#EFE8DA' },
  tripPhaseActive: { backgroundColor: colors.primaryPale },
  tripPhaseEnded: { backgroundColor: '#E9E5DD' },
  tripPhaseBadgeText: { color: colors.ink, fontSize: 10, fontWeight: '700' },
  settledDate: { color: colors.muted, fontSize: 11 },
  actionRow: { flexDirection: 'row', gap: 10, marginBottom: 25 },
  expenseCard: { backgroundColor: 'transparent', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line, borderRadius: 0, paddingHorizontal: 3, paddingVertical: 13, marginBottom: 1 },
  expenseTop: { flexDirection: 'row', alignItems: 'center' },
  expenseActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 8 },
  expenseActionButton: { minWidth: 48, minHeight: 48, paddingHorizontal: 10, borderRadius: 24, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  expenseActionText: { color: colors.primaryDark, fontSize: 11, fontWeight: '700' },
  expenseDeleteText: { color: colors.orange, fontSize: 11, fontWeight: '700' },
  expenseAmount: { color: colors.ink, fontSize: 14, fontWeight: '800', marginLeft: 10 },
  settlementTotal: { backgroundColor: colors.primaryPale, borderRadius: 5, padding: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 23 },
  settlementStatusCard: { backgroundColor: '#EFE8DA', borderWidth: 1, borderColor: '#E1D7C6', borderRadius: 5, padding: 16, marginBottom: 20 },
  settlementStatusCopy: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  settlementStatusDescription: { flex: 1, color: colors.muted, fontSize: 12, lineHeight: 18 },
  settlementStatusAction: { width: '100%', minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.greenAction, borderRadius: 6, marginTop: 16, paddingHorizontal: 16 },
  reopenSettlementAction: { backgroundColor: colors.greenPale, borderWidth: 1, borderColor: colors.green, minHeight: 48 },
  settlementStatusActionText: { color: colors.surface, fontSize: 15, fontWeight: '800', letterSpacing: 0.2 },
  reopenSettlementActionText: { color: colors.greenDark, fontSize: 14 },
  balanceCard: { backgroundColor: 'transparent', borderRadius: 0, paddingHorizontal: 3, marginBottom: 21 },
  balanceRow: { minHeight: 55, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  lastRow: { borderBottomWidth: 0 },
  balanceName: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  balanceAmount: { fontSize: 13, fontWeight: '700' },
  receive: { color: colors.greenDark },
  pay: { color: colors.orange },
  even: { color: colors.muted },
  transferCard: { backgroundColor: 'transparent', borderRadius: 0, paddingHorizontal: 3, marginBottom: 14 },
  transferRow: { minHeight: 66, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  transferNumber: { width: 25, height: 25, borderRadius: 13, backgroundColor: colors.primaryPale, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  transferNumberText: { color: colors.primaryDark, fontSize: 11, fontWeight: '800' },
  transferText: { flex: 1, color: colors.muted, fontSize: 12 },
  transferName: { color: colors.ink, fontWeight: '700' },
  transferAmount: { color: colors.ink, fontSize: 13, fontWeight: '800', marginLeft: 6 },
  emptyTransfer: { color: colors.muted, fontSize: 13, textAlign: 'center', paddingVertical: 20 },
  settlementNote: { color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: 'center', marginBottom: 12 },
  localNote: { color: colors.muted, fontSize: 11, textAlign: 'center', marginTop: 24 },
  storageGate: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28 },
  storageGateTitle: { color: colors.ink, fontSize: 17, fontWeight: '800', textAlign: 'center', marginTop: 16 },
  storageGateDescription: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 10, marginBottom: 12 },
  storageWarning: { backgroundColor: '#FFF2E8', borderRadius: 12, padding: 12, marginBottom: 14 },
  storageWarningText: { color: colors.ink, fontSize: 12, lineHeight: 18 },
});





