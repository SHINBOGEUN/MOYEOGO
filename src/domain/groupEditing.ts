import type { Group } from './models';
import type { Member } from './settlement';

/** A saved member referenced by a trip cannot be removed without breaking its records. */
export function getMemberRemovalError(group: Group, memberId: string): string | null {
  if (group.members[0]?.id === memberId) return '모임을 만든 사람은 삭제할 수 없어요.';
  for (const trip of group.trips) {
    if (trip.treasurerId === memberId) return `‘${trip.name}’ 여행의 총무라서 삭제할 수 없어요.`;
    for (const expense of trip.expenses) {
      if (expense.payerId === memberId) return `‘${trip.name}’ 여행의 결제 내역에 있어 삭제할 수 없어요.`;
      if (expense.participantIds.includes(memberId)) return `‘${trip.name}’ 여행의 지출 참여자라서 삭제할 수 없어요.`;
    }
  }
  return null;
}

/** Applies a complete edit draft while preserving every retained member's ID/order and all trip data. */
export function applyGroupEdits(group: Group, draftName: string, draftMembers: Member[]): Group {
  const name = draftName.trim();
  if (!name) throw new Error('모임 이름을 입력해 주세요.');
  if (draftMembers.length < 2) throw new Error('친구를 한 명 이상 추가해 주세요.');

  const owner = group.members[0];
  if (!owner || draftMembers[0]?.id !== owner.id || draftMembers[0]?.name !== owner.name) {
    throw new Error('모임을 만든 사람은 변경할 수 없어요.');
  }

  const originalIds = new Set(group.members.map((member) => member.id));
  const nextIds = new Set<string>();
  const normalizedNames = new Set<string>();
  const retainedIds: string[] = [];
  let hasNewMember = false;
  const members = draftMembers.map((member) => {
    const memberName = member.name.trim();
    if (!member.id.trim() || nextIds.has(member.id)) throw new Error('멤버 정보가 중복되었어요. 다시 시도해 주세요.');
    if (!memberName) throw new Error('멤버 이름을 입력해 주세요.');
    const normalizedName = memberName.toLocaleLowerCase();
    if (normalizedNames.has(normalizedName)) throw new Error('같은 닉네임은 모임에 두 번 추가할 수 없어요.');
    nextIds.add(member.id);
    normalizedNames.add(normalizedName);
    if (originalIds.has(member.id)) {
      if (hasNewMember) throw new Error('기존 멤버의 순서는 변경할 수 없어요.');
      retainedIds.push(member.id);
    } else {
      hasNewMember = true;
    }
    return { ...member, name: memberName };
  });

  const expectedOrder = group.members.filter((member) => nextIds.has(member.id)).map((member) => member.id);
  if (retainedIds.some((id, index) => id !== expectedOrder[index])) {
    throw new Error('기존 멤버의 순서는 변경할 수 없어요.');
  }
  for (const originalMember of group.members) {
    if (nextIds.has(originalMember.id)) continue;
    const removalError = getMemberRemovalError(group, originalMember.id);
    if (removalError) throw new Error(removalError);
  }

  return { ...group, name, members };
}
