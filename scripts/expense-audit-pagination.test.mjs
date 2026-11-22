import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { appendExpenseAuditPage } from '../src/domain/expenseAuditPagination.ts';

const item = (eventKey) => ({ eventKey });

test('expense audit pagination appends new events and filters duplicate keys', () => {
  const result = appendExpenseAuditPage(
    [item('a'), item('b')],
    [item('b'), item('c'), item('c'), item('d')],
  );
  assert.deepEqual(result.map(({ eventKey }) => eventKey), ['a', 'b', 'c', 'd']);
});

test('expense audit summaries are not rendered alongside the group activity feed', () => {
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /listGroupExpenseAudit\(/);
  assert.match(app, /listGroupActivity\(selectedGroupDbId, \{ tripId: trip\.id, limit: 5 \}/);
  assert.match(app, /groupActivityKey/);
  assert.match(app, /appendGroupActivityPage/);
  assert.match(app, /trip\.name/);
});
