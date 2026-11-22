import type { Group } from './models';

export type RemoteGroupRequestGeneration = { sequence: number; accountEpoch: number };

export class RemoteGroupRefreshGeneration {
  private activeUserId: string | null = null;
  private accountEpoch = 0;
  private requestSequence = 0;
  private readonly requestsByUser = new Map<string, RemoteGroupRequestGeneration>();

  setActiveUser(userId: string | null): void {
    if (this.activeUserId === userId) return;
    this.activeUserId = userId;
    this.accountEpoch += 1;
  }

  begin(userId: string): RemoteGroupRequestGeneration | null {
    if (this.activeUserId !== userId) return null;
    const requestGeneration = { sequence: ++this.requestSequence, accountEpoch: this.accountEpoch };
    this.requestsByUser.set(userId, requestGeneration);
    return requestGeneration;
  }

  isCurrent(userId: string, requestGeneration: RemoteGroupRequestGeneration): boolean {
    return this.activeUserId === userId
      && this.requestsByUser.get(userId)?.sequence === requestGeneration.sequence
      && this.accountEpoch === requestGeneration.accountEpoch;
  }
}

export function mergeRemoteGroupSnapshot(
  remoteGroups: Group[],
  currentGroups: Group[],
  previouslyKnownRemoteGroupIds: ReadonlySet<string>,
): Group[] {
  const remoteIds = new Set(remoteGroups.map((group) => group.id));
  return [
    ...remoteGroups,
    ...currentGroups.filter((group) =>
      !remoteIds.has(group.id) && !previouslyKnownRemoteGroupIds.has(group.id)),
  ];
}

export function isRemoteMemberActive(
  memberId: string | undefined,
  status: string | undefined,
): boolean {
  return Boolean(memberId && status === 'active');
}

export function isMemberActiveForDisplay(
  memberId: string | undefined,
  status: string | undefined,
  hasAuthenticatedAccount: boolean,
): boolean {
  return Boolean(memberId && (!hasAuthenticatedAccount || status === 'active'));
}
