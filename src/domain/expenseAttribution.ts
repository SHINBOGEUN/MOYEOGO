import type { Member } from './settlement';

export function getExpenseCreatorName(
  createdByUserId: string | undefined,
  members: Member[],
  memberAccounts: Record<string, string>,
): string {
  if (!createdByUserId) return '등록자 정보 없음';
  const memberId = Object.entries(memberAccounts)
    .find(([, userId]) => userId === createdByUserId)?.[0];
  return members.find((member) => member.id === memberId)?.name ?? '등록자 정보 없음';
}
