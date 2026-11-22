import test from 'node:test';
import assert from 'node:assert/strict';
import { applyGroupEdits, getMemberRemovalError } from '../src/domain/groupEditing.ts';

const group = {
  id: 'group-1',
  name: '옛 모임',
  members: [
    { id: 'owner', name: '예전 닉네임' },
    { id: 'treasurer', name: '총무' },
    { id: 'payer', name: '결제자' },
    { id: 'participant', name: '참여자' },
    { id: 'guest', name: '손님' },
  ],
  trips: [{
    id: 'trip-1', name: '강릉', destination: '강릉', detailAddress: '', dateRange: '2026. 10. 15. - 2026. 10. 16.',
    treasurerId: 'treasurer', settledAt: '2026-10-16T00:00:00Z',
    photos: [{ id: 'photo', uri: 'file:///photo.jpg', addedAt: '2026-10-15' }],
    expenses: [{ id: 'expense-1', title: '점심', amount: 10001, payerId: 'payer', participantIds: ['owner', 'participant'] }],
  }],
};

test('이름과 멤버를 수정해도 ID, 기존 순서, 여행·지출·정산 참조가 유지된다', () => {
  const next = applyGroupEdits(group, '  새 모임  ', [
    group.members[0],
    { ...group.members[1], name: '새 총무' },
    group.members[2],
    group.members[3],
    { id: 'new', name: '새 친구' },
  ]);
  assert.equal(next.id, group.id);
  assert.equal(next.name, '새 모임');
  assert.deepEqual(next.members.map(({ id }) => id), ['owner', 'treasurer', 'payer', 'participant', 'new']);
  assert.equal(next.members[1].name, '새 총무');
  assert.strictEqual(next.trips, group.trips);
  assert.equal(group.name, '옛 모임');
  assert.equal(group.members[1].name, '총무');
});

test('모임 만든 사람과 여행 참조 멤버는 삭제할 수 없다', () => {
  for (const id of ['owner', 'treasurer', 'payer', 'participant']) {
    assert.ok(getMemberRemovalError(group, id));
    assert.throws(() => applyGroupEdits(group, '새 모임', group.members.filter((member) => member.id !== id)));
  }
  assert.equal(getMemberRemovalError(group, 'guest'), null);
});

test('빈 이름, 중복 이름, 한 명만 남기는 수정과 기존 순서 변경을 막는다', () => {
  assert.throws(() => applyGroupEdits(group, ' ', group.members), /모임 이름/);
  assert.throws(() => applyGroupEdits(group, '모임', [group.members[0]]), /한 명 이상/);
  assert.throws(() => applyGroupEdits(group, '모임', [group.members[0], { ...group.members[1], name: ' ' }, ...group.members.slice(2)]), /멤버 이름/);
  assert.throws(() => applyGroupEdits(group, '모임', [group.members[0], { ...group.members[1], name: ' 손님 ' }, ...group.members.slice(2)]), /두 번/);
  assert.throws(() => applyGroupEdits(group, '모임', [group.members[0], group.members[2], group.members[1], ...group.members.slice(3)]), /순서/);
  assert.throws(() => applyGroupEdits(group, '모임', [{ ...group.members[0], name: '현재 닉네임' }, ...group.members.slice(1)]), /만든 사람/);
});
