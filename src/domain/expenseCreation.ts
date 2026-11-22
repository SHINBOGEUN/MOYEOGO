import type { Expense } from './settlement';

export function createExpense(
  expense: Omit<Expense, 'createdByUserId'>,
  createdByUserId: string | undefined,
): Expense {
  return { ...expense, createdByUserId };
}
