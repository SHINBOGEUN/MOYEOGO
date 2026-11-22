const GROUP_ACTIVITY_RPC_NAME = 'list_group_trip_activity' as const;
const SAFE_RPC_ERROR_CODES = {
  PGRST202: 'PGRST202',
} as const;
const OTHER_RPC_ERROR_CODE = 'OTHER' as const;

function mapSafeRpcErrorCode(code: unknown): string | undefined {
  if (typeof code !== 'string') return undefined;
  return Object.prototype.hasOwnProperty.call(SAFE_RPC_ERROR_CODES, code)
    ? SAFE_RPC_ERROR_CODES[code as keyof typeof SAFE_RPC_ERROR_CODES]
    : OTHER_RPC_ERROR_CODE;
}

export class GroupActivityRpcError extends Error {
  readonly code?: string;
  readonly status?: number;

  constructor(error: { code?: unknown; status?: unknown }) {
    super('Unable to load group activity.');
    this.name = 'GroupActivityRpcError';
    this.code = mapSafeRpcErrorCode(error.code);
    this.status = typeof error.status === 'number' && Number.isInteger(error.status) && error.status >= 100 && error.status <= 599
      ? error.status
      : undefined;
  }
}

/** A fixed, allowlisted diagnostic shape for development logging. */
export function getGroupActivityRpcDiagnostic(error: unknown): {
  rpc: typeof GROUP_ACTIVITY_RPC_NAME;
  code?: string;
  status?: number;
} | null {
  if (!(error instanceof GroupActivityRpcError)) return null;
  return {
    rpc: GROUP_ACTIVITY_RPC_NAME,
    ...(error.code ? { code: error.code } : {}),
    ...(error.status !== undefined ? { status: error.status } : {}),
  };
}
