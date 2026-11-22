export type Member = {
  id: string;
  name: string;
};

export type Expense = {
  id: string;
  title: string;
  amount: number;
  payerId: string;
  participantIds: string[];
  /** Authenticated account that first recorded the expense; absent on legacy data. */
  createdByUserId?: string;
  /** Present only for expenses registered in the shared trip sync store. */
  version?: number;
};

export type Transfer = {
  fromMemberId: string;
  toMemberId: string;
  amount: number;
};

function assertWholeWon(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error('금액은 0 이상의 정수 원 단위여야 합니다.');
  }
}

export function calculateExpenseShares(
  amount: number,
  participantIds: string[],
  members: Member[],
): Record<string, number> {
  assertWholeWon(amount);
  const memberOrder = new Map(members.map((member, index) => [member.id, index]));
  const uniqueParticipantIds = [...new Set(participantIds)];

  if (uniqueParticipantIds.length === 0) {
    throw new Error('지출을 나눌 멤버를 한 명 이상 선택해 주세요.');
  }
  if (uniqueParticipantIds.some((id) => !memberOrder.has(id))) {
    throw new Error('선택된 지출 참여자를 모임 멤버에서 찾을 수 없습니다.');
  }

  const orderedIds = uniqueParticipantIds.sort(
    (left, right) => memberOrder.get(left)! - memberOrder.get(right)!,
  );
  const baseShare = Math.floor(amount / orderedIds.length);
  const remainingWon = amount % orderedIds.length;

  return Object.fromEntries(
    orderedIds.map((id, index) => [id, baseShare + (index < remainingWon ? 1 : 0)]),
  );
}

export function calculateBalances(
  members: Member[],
  expenses: Expense[],
): Record<string, number> {
  const balances = Object.fromEntries(members.map((member) => [member.id, 0]));

  for (const expense of expenses) {
    assertWholeWon(expense.amount);
    if (!(expense.payerId in balances)) {
      throw new Error('결제자를 모임 멤버에서 찾을 수 없습니다.');
    }

    balances[expense.payerId] += expense.amount;
    const shares = calculateExpenseShares(expense.amount, expense.participantIds, members);
    for (const [memberId, share] of Object.entries(shares)) {
      balances[memberId] -= share;
    }
  }

  if (Object.values(balances).some((balance) => !Number.isSafeInteger(balance))) {
    throw new Error('정산 금액이 안전한 계산 범위를 벗어났습니다.');
  }
  return balances;
}

/**
 * Partitions the member balances into the greatest number of zero-sum groups.
 * Each indivisible group can be settled in exactly groupSize - 1 transfers,
 * which yields the minimum number of transfers overall. Search order follows
 * the saved member order, so equally minimal plans remain deterministic.
 */
export function calculateMinimumTransfers(
  members: Member[],
  balances: Record<string, number>,
): Transfer[] {
  const active = members
    .map((member) => ({ member, balance: balances[member.id] ?? 0 }))
    .filter(({ balance }) => balance !== 0);

  if (active.length === 0) return [];
  if (active.some(({ balance }) => !Number.isSafeInteger(balance))) {
    throw new Error('정산 금액이 안전한 계산 범위를 벗어났습니다.');
  }
  if (active.reduce((sum, item) => sum + item.balance, 0) !== 0) {
    throw new Error('정산 잔액의 합계가 0이 아닙니다. 지출 내역을 확인해 주세요.');
  }

  const bitIndexes = new Map<bigint, number>();
  active.forEach((_, index) => bitIndexes.set(1n << BigInt(index), index));
  const sumMemo = new Map<bigint, number>([[0n, 0]]);
  const groupMemo = new Map<bigint, bigint[]>([[0n, []]]);

  const sumFor = (mask: bigint): number => {
    const cached = sumMemo.get(mask);
    if (cached !== undefined) return cached;
    const firstBit = mask & -mask;
    const index = bitIndexes.get(firstBit);
    if (index === undefined) throw new Error('정산 계산 중 멤버 순서를 찾지 못했습니다.');
    const sum = active[index].balance + sumFor(mask ^ firstBit);
    sumMemo.set(mask, sum);
    return sum;
  };

  const groupsFor = (mask: bigint): bigint[] => {
    const cached = groupMemo.get(mask);
    if (cached) return cached;

    const firstBit = mask & -mask;
    let best: bigint[] | undefined;
    const zeroSumSubsets: bigint[] = [];
    for (let subset = mask; subset > 0n; subset = (subset - 1n) & mask) {
      if ((subset & firstBit) !== 0n && sumFor(subset) === 0) zeroSumSubsets.push(subset);
    }
    // Smaller masks place earlier members first and resolve equal plans consistently.
    zeroSumSubsets.reverse();
    for (const subset of zeroSumSubsets) {
      const candidate = [subset, ...groupsFor(mask ^ subset)];
      if (!best || candidate.length > best.length) best = candidate;
    }

    if (!best) throw new Error('정산 가능한 송금 조합을 찾지 못했습니다.');
    groupMemo.set(mask, best);
    return best;
  };

  const fullMask = (1n << BigInt(active.length)) - 1n;
  const groups = groupsFor(fullMask);
  const transfers: Transfer[] = [];

  for (const groupMask of groups) {
    const groupMembers = active.filter((_, index) => (groupMask & (1n << BigInt(index))) !== 0n);
    const debtors = groupMembers
      .filter(({ balance }) => balance < 0)
      .map(({ member, balance }) => ({ member, remaining: -balance }));
    const creditors = groupMembers
      .filter(({ balance }) => balance > 0)
      .map(({ member, balance }) => ({ member, remaining: balance }));

    let debtorIndex = 0;
    let creditorIndex = 0;
    while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
      const debtor = debtors[debtorIndex];
      const creditor = creditors[creditorIndex];
      const amount = Math.min(debtor.remaining, creditor.remaining);
      transfers.push({
        fromMemberId: debtor.member.id,
        toMemberId: creditor.member.id,
        amount,
      });
      debtor.remaining -= amount;
      creditor.remaining -= amount;
      if (debtor.remaining === 0) debtorIndex += 1;
      if (creditor.remaining === 0) creditorIndex += 1;
    }
  }

  return transfers;
}
