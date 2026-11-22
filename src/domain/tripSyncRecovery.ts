import type { Trip } from './models';
import type { Expense } from './settlement';
import type { RemoteTripSyncSnapshot, SyncCommandResult } from '../data/remoteTripSync';

export type TripSyncCommandStatus = {
  commandId?: string;
  localSaved: boolean;
  remoteState: 'not_sent' | 'pending' | 'applied' | 'rejected' | 'unknown';
  failureStage?: 'local_save' | 'request' | 'server';
  errorCode?: string;
  outcomeUnknown: boolean;
  safeToResend: boolean;
};

export function tripSyncCommandStatusFromResult<T>(
  result: SyncCommandResult<T>,
  localSaved: boolean,
): TripSyncCommandStatus {
  return {
    commandId: result.commandId,
    localSaved,
    remoteState: 'applied',
    outcomeUnknown: false,
    safeToResend: false,
  };
}

/** Build the UI status from a safe, normalized sync error. A snapshot refresh is still
 * required to reconcile local data when the command outcome is unknown. */
export function tripSyncCommandStatusFromError(
  error: unknown,
  localSaved: boolean,
): TripSyncCommandStatus {
  const candidate = error && typeof error === 'object'
    ? error as { name?: unknown; commandId?: unknown; remoteState?: unknown; stage?: unknown; code?: unknown; safeToResend?: unknown }
    : undefined;
  const isRemoteError = candidate?.name === 'RemoteTripSyncError';
  const remoteState = isRemoteError && candidate.remoteState === 'rejected' ? 'rejected' : 'unknown';
  const code = isRemoteError && typeof candidate.code === 'string' && /^[a-z0-9_]{1,64}$/.test(candidate.code)
    ? candidate.code : undefined;
  const failureStage = !localSaved ? 'local_save' : remoteState === 'rejected' ? 'server' : 'request';
  const commandId = isRemoteError && typeof candidate.commandId === 'string' ? candidate.commandId : undefined;
  const safeToResend = localSaved && isRemoteError && candidate.safeToResend === true && Boolean(commandId);
  return {
    ...(commandId ? { commandId } : {}),
    localSaved,
    remoteState,
    failureStage,
    ...(code ? { errorCode: code } : {}),
    outcomeUnknown: remoteState === 'unknown',
    safeToResend,
  };
}

/** Reconcile only the requested shared expense, preserving concurrent local edits to other entities. */
export function reconcileExpenseFromRemoteSnapshot(
  trip: Trip,
  snapshot: RemoteTripSyncSnapshot,
  expenseId: string,
): Trip {
  const remote = snapshot.expenses.find((expense) => expense.id === expenseId);
  const hasExpense = trip.expenses.some((expense) => expense.id === expenseId);
  return {
    ...trip,
    expenses: remote
      ? hasExpense
        ? trip.expenses.map((expense) => expense.id === expenseId ? { ...remote } : expense)
        : [{ ...remote }, ...trip.expenses]
      : trip.expenses.filter((expense) => expense.id !== expenseId),
    syncRevision: Math.max(trip.syncRevision ?? -1, snapshot.groupRevision),
  };
}

/** Restore a previous expense only while the failed optimistic operation still owns its entity. */
export function rollbackExpenseOperation(
  trip: Trip,
  expenseId: string,
  previous: Expense | undefined,
  optimistic: Expense | undefined,
): Trip {
  const current = trip.expenses.find((expense) => expense.id === expenseId);
  if (current !== optimistic) return trip;
  return {
    ...trip,
    expenses: previous
      ? current
        ? trip.expenses.map((expense) => expense.id === expenseId ? previous : expense)
        : [previous, ...trip.expenses]
      : trip.expenses.filter((expense) => expense.id !== expenseId),
  };
}

/** Reconcile only settlement state, leaving expense/photo state untouched. */
export function reconcileSettlementFromRemoteSnapshot(trip: Trip, snapshot: RemoteTripSyncSnapshot): Trip {
  return {
    ...trip,
    settledAt: snapshot.settledAt,
    syncRevision: Math.max(trip.syncRevision ?? -1, snapshot.groupRevision),
  };
}

export function rollbackSettlementOperation(
  trip: Trip,
  previous: string | undefined,
  optimistic: string | undefined,
): Trip {
  if (trip.settledAt !== optimistic) return trip;
  return { ...trip, settledAt: previous };
}
