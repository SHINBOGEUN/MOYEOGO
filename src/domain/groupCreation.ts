import type { Member } from './settlement';

/** Builds the visible member order for a new group; the signed-in owner is always first. */
export function buildGroupMemberNames(ownerNickname: string, friendNames: string[]): string[] {
  const owner = ownerNickname.trim();
  const friends = friendNames.map((name) => name.trim()).filter(Boolean);
  if (!owner) throw new Error('내 닉네임을 입력해 주세요.');
  if (friends.length === 0) throw new Error('친구를 한 명 이상 추가해 주세요.');

  const normalizedNames = new Set<string>();
  for (const name of [owner, ...friends]) {
    const normalized = name.toLocaleLowerCase();
    if (normalizedNames.has(normalized)) throw new Error('같은 닉네임은 모임에 두 번 추가할 수 없어요.');
    normalizedNames.add(normalized);
  }
  return [owner, ...friends];
}

/** Merges selected app-friend nicknames into manual guest entries without duplicating members. */
export function mergeSelectedFriendNames(ownerNickname: string, existingNames: string[], selectedNames: string[]) {
  const seen = new Set([ownerNickname, ...existingNames].map((name) => name.trim().toLocaleLowerCase()).filter(Boolean));
  const added: string[] = [];
  const skipped: string[] = [];

  for (const rawName of selectedNames) {
    const name = rawName.trim();
    if (!name) continue;
    const normalized = name.toLocaleLowerCase();
    if (seen.has(normalized)) {
      skipped.push(name);
      continue;
    }
    seen.add(normalized);
    added.push(name);
  }

  return { added, skipped };
}
/** Maps only explicitly selected friend names to their newly created group member IDs. */
export function buildRemoteFriendInvites(members: Member[], friendAccountsByName: Record<string, string>) {
  return members.flatMap((member) => {
    const friendUserId = friendAccountsByName[member.name];
    return friendUserId ? [{ memberId: member.id, friendUserId }] : [];
  });
}
