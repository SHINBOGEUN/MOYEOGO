import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGroupMemberNames, buildRemoteFriendInvites, mergeSelectedFriendNames } from '../src/domain/groupCreation.ts';

test('모임 만든 사람의 닉네임이 항상 첫 멤버로 들어간다', () => {
  assert.deepEqual(buildGroupMemberNames('  보근  ', ['민지', '수현']), ['보근', '민지', '수현']);
});

test('accepted friends map by member ID while guests remain name-only', () => {
  assert.deepEqual(
    buildRemoteFriendInvites([
      { id: 'owner-member', name: 'Owner' },
      { id: 'friend-member', name: 'Friend' },
      { id: 'guest-member', name: 'Guest' },
    ], { Friend: 'friend-user-id' }),
    [{ memberId: 'friend-member', friendUserId: 'friend-user-id' }],
  );
});

test('본인을 제외하고 친구 한 명 이상을 추가해야 모임을 만든다', () => {
  assert.throws(() => buildGroupMemberNames('보근', []), /친구를 한 명 이상/);
});

test('본인과 같은 닉네임 또는 중복 닉네임을 막는다', () => {
  assert.throws(() => buildGroupMemberNames('보근', ['보근']), /두 번 추가/);
  assert.throws(() => buildGroupMemberNames('보근', ['민지', ' 민지 ']), /두 번 추가/);
});

test('앱 친구 여러 명을 선택해 기존 멤버 중복 없이 추가한다', () => {
  assert.deepEqual(
    mergeSelectedFriendNames('보근', ['민지'], ['수현', '민지', '보근', ' 지우 ']),
    { added: ['수현', '지우'], skipped: ['민지', '보근'] },
  );
});
