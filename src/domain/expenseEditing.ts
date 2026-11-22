import type { Trip } from './models';
import type { Expense } from './settlement';

export function replaceTripExpense(trip: Trip, updatedExpense: Expense): Trip {
  return {
    ...trip,
    expenses: trip.expenses.map((expense) =>
      expense.id === updatedExpense.id
        ? { ...updatedExpense, createdByUserId: expense.createdByUserId }
        : expense,
    ),
  };
}

export function removeTripExpense(trip: Trip, expenseId: string): Trip {
  return {
    ...trip,
    expenses: trip.expenses.filter((expense) => expense.id !== expenseId),
  };
}
