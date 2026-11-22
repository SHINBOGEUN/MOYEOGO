import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateBalances,
  calculateExpenseShares,
  calculateMinimumTransfers,
} from '../src/domain/settlement.ts';
import { removeTripExpense, replaceTripExpense } from '../src/domain/expenseEditing.ts';
import { createExpense } from '../src/domain/expenseCreation.ts';
import { getExpenseCreatorName } from '../src/domain/expenseAttribution.ts';

const members = [
  { id: 'a', name: '민지' },
  { id: 'b', name: '준호' },
  { id: 'c', name: '서연' },
  { id: 'd', name: '도윤' },
];

test('creating an expense records the currently authenticated user as its creator', () => {
  const expense = createExpense({
    id: 'new', title: 'meal', amount: 10, payerId: 'a', participantIds: ['a'],
  }, 'current-auth-user');

  assert.equal(expense.createdByUserId, 'current-auth-user');
});

test('editing an expense preserves its original creator and deleting another keeps attribution intact', () => {
  const trip = {
    id: 'trip', name: 'trip', destination: '', detailAddress: '', dateRange: '', treasurerId: 'a',
    expenses: [
      { id: 'edit', title: 'meal', amount: 10, payerId: 'a', participantIds: ['a'], createdByUserId: 'user-a' },
      { id: 'keep', title: 'taxi', amount: 20, payerId: 'b', participantIds: ['b'], createdByUserId: 'user-b' },
      { id: 'legacy', title: 'old', amount: 30, payerId: 'c', participantIds: ['c'] },
    ],
  };
  const edited = replaceTripExpense(trip, {
    id: 'edit', title: 'meal edited', amount: 11, payerId: 'b', participantIds: ['a', 'b'], createdByUserId: 'user-b',
  });
  assert.equal(edited.expenses[0].createdByUserId, 'user-a');
  const deleted = removeTripExpense(edited, 'edit');
  assert.equal(deleted.expenses.find(({ id }) => id === 'keep')?.createdByUserId, 'user-b');
  assert.equal(deleted.expenses.find(({ id }) => id === 'legacy')?.createdByUserId, undefined);
});

test('expense creator resolves through memberAccounts and reports missing or unlinked attribution', () => {
  const namedMembers = [{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }];
  const accounts = { a: 'user-a', b: 'user-b' };
  assert.equal(getExpenseCreatorName('user-b', namedMembers, accounts), 'Bob');
  assert.equal(getExpenseCreatorName(undefined, namedMembers, accounts), '등록자 정보 없음');
  assert.equal(getExpenseCreatorName('unlinked-user', namedMembers, accounts), '등록자 정보 없음');
  assert.equal(getExpenseCreatorName('user-c', namedMembers, { a: 'user-a' }), '등록자 정보 없음');
});

test('분할 나머지 1원은 모임 멤버 순서대로 나눠진다', () => {
  assert.deepEqual(calculateExpenseShares(10000, ['c', 'a', 'b'], members), {
    a: 3334,
    b: 3333,
    c: 3333,
  });
});

test('결제자는 해당 지출의 참여자가 아니어도 된다', () => {
  const balances = calculateBalances(members, [
    { id: 'meal', title: '점심', amount: 9000, payerId: 'd', participantIds: ['a', 'b'] },
  ]);

  assert.deepEqual(balances, { a: -4500, b: -4500, c: 0, d: 9000 });
});

test('같은 최소 송금 횟수에서는 멤버 순서를 따르는 하나의 결과를 고른다', () => {
  const transfers = calculateMinimumTransfers(members, {
    a: 5000,
    b: 5000,
    c: -5000,
    d: -5000,
  });

  assert.deepEqual(transfers, [
    { fromMemberId: 'c', toMemberId: 'a', amount: 5000 },
    { fromMemberId: 'd', toMemberId: 'b', amount: 5000 },
  ]);
});

test('송금 결과는 각 잔액을 0으로 만들고 최소 송금 횟수를 사용한다', () => {
  const balances = { a: 10000, b: 10000, c: -5000, d: -5000, e: -10000 };
  const expandedMembers = [...members, { id: 'e', name: '하늘' }];
  const transfers = calculateMinimumTransfers(expandedMembers, balances);

  assert.equal(transfers.length, 3);
  const settled = { ...balances };
  for (const transfer of transfers) {
    settled[transfer.fromMemberId] += transfer.amount;
    settled[transfer.toMemberId] -= transfer.amount;
  }
  assert.deepEqual(Object.values(settled), [0, 0, 0, 0, 0]);
});

test('지출 수정은 같은 기록을 교체하고 현재 내역 기준으로 잔액을 다시 계산한다', () => {
  const trip = {
    id: 'trip', name: '여행', destination: '강릉', detailAddress: '', dateRange: '', treasurerId: 'a',
    expenses: [
      { id: 'meal', title: '점심', amount: 9000, payerId: 'a', participantIds: ['a', 'b'] },
      { id: 'stay', title: '숙소', amount: 12000, payerId: 'b', participantIds: ['a', 'b'] },
    ],
  };
  const updated = replaceTripExpense(trip, {
    id: 'meal', title: '저녁', amount: 6000, payerId: 'b', participantIds: ['a', 'b', 'c'],
  });

  assert.equal(updated.expenses.length, 2);
  assert.equal(updated.expenses[0].id, 'meal');
  assert.deepEqual(calculateBalances(members, updated.expenses), { a: -8000, b: 10000, c: -2000, d: 0 });
});

test('지출 삭제는 선택한 기록만 제거하고 현재 내역 기준으로 잔액을 다시 계산한다', () => {
  const trip = {
    id: 'trip', name: '여행', destination: '강릉', detailAddress: '', dateRange: '', treasurerId: 'a',
    expenses: [
      { id: 'meal', title: '점심', amount: 9000, payerId: 'a', participantIds: ['a', 'b'] },
      { id: 'stay', title: '숙소', amount: 12000, payerId: 'b', participantIds: ['a', 'b'] },
    ],
  };
  const updated = removeTripExpense(trip, 'meal');

  assert.deepEqual(updated.expenses.map(({ id }) => id), ['stay']);
  assert.deepEqual(calculateBalances(members, updated.expenses), { a: -6000, b: 6000, c: 0, d: 0 });
});
