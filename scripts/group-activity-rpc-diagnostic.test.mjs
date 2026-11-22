import assert from 'node:assert/strict';
import test from 'node:test';
import { getGroupActivityRpcDiagnostic, GroupActivityRpcError } from '../src/data/groupActivityRpcError.ts';

test('keeps RPC diagnostics to the fixed name, safe code, and numeric HTTP status', () => {
  const error = new GroupActivityRpcError({
    code: 'PGRST202',
    status: 503,
    message: 'private message including https://example.invalid and token=secret',
    details: 'user/group/trip identifiers and payload',
    hint: 'sensitive hint',
  });
  assert.equal(error.message, 'Unable to load group activity.');
  assert.deepEqual(getGroupActivityRpcDiagnostic(error), {
    rpc: 'list_group_trip_activity', code: 'PGRST202', status: 503,
  });
  assert.equal(JSON.stringify(getGroupActivityRpcDiagnostic(error)).includes('secret'), false);
});

test('drops unsafe diagnostic values and ignores non-RPC errors', () => {
  const diagnostic = getGroupActivityRpcDiagnostic(new GroupActivityRpcError({ code: 'secret/token', status: 2000 }));
  assert.deepEqual(diagnostic, { rpc: 'list_group_trip_activity', code: 'OTHER' });
  assert.equal(JSON.stringify(diagnostic).includes('secret/token'), false);
  assert.equal(getGroupActivityRpcDiagnostic(new Error('private')), null);
});

test('maps unregistered identifier-shaped codes to the fixed OTHER value', () => {
  for (const code of ['privateuser123', 'group_42', '1234567890']) {
    const diagnostic = getGroupActivityRpcDiagnostic(new GroupActivityRpcError({ code, status: 503 }));
    assert.deepEqual(diagnostic, { rpc: 'list_group_trip_activity', code: 'OTHER', status: 503 });
    assert.equal(JSON.stringify(diagnostic).includes(code), false);
  }
});
