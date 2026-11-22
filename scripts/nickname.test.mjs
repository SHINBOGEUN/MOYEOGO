import assert from 'node:assert/strict';
import test from 'node:test';
import { getNicknameError, normalizeFriendCode, normalizeNickname } from '../src/domain/nickname.ts';

test('nickname accepts Hangul, Latin letters, digits, and underscore in the allowed length', () => {
  assert.equal(getNicknameError('여행친구_01'), null);
});

test('nickname validation trims whitespace and rejects invalid length and symbols', () => {
  assert.equal(normalizeNickname('  여행   친구  '), '여행 친구');
  assert.match(getNicknameError('a') ?? '', /2~16자/);
  assert.match(getNicknameError('여행친구!') ?? '', /한글/);
  assert.equal(getNicknameError('  여행친구  '), null);
});

test('friend IDs are trimmed and normalized to uppercase', () => {
  assert.equal(normalizeFriendCode(' mg-a1b2 c3d4 '), 'MG-A1B2C3D4');
});
