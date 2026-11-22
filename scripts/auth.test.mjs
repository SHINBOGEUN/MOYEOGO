import test from 'node:test';
import assert from 'node:assert/strict';
import { getSignupPasswordError, getSignupPasswordRequirements } from '../src/domain/passwordPolicy.ts';
import { hasVerifiedEmailForApp, isDuplicateSignupResponse } from '../src/domain/authSignup.ts';

test('signup password requires eight characters, an uppercase letter, and a supported symbol', () => {
  assert.deepEqual(getSignupPasswordRequirements('Abcdefg!').map(({ met }) => met), [true, true, true]);
  assert.deepEqual(getSignupPasswordRequirements('Abc!234').map(({ met }) => met), [false, true, true]);
  assert.deepEqual(getSignupPasswordRequirements('abcdefg!').map(({ met }) => met), [true, false, true]);
  assert.deepEqual(getSignupPasswordRequirements('Abcdefgh').map(({ met }) => met), [true, true, false]);
});

test('signup rejects mismatched password confirmation and accepts matching valid values', () => {
  assert.equal(getSignupPasswordError('Abcdefg!', 'Abcdefg?'), '비밀번호 확인이 일치하지 않아요.');
  assert.equal(getSignupPasswordError('Abcdefg!', 'Abcdefg!'), null);
});

test('signup identifies Supabase obfuscated responses for existing accounts', () => {
  assert.equal(isDuplicateSignupResponse({ identities: [] }), true);
  assert.equal(isDuplicateSignupResponse({ identities: [{ provider: 'email' }] }), false);
  assert.equal(isDuplicateSignupResponse({}), false);
  assert.equal(isDuplicateSignupResponse(null), false);
});

test('only an email-confirmed account can enter the app', () => {
  assert.equal(hasVerifiedEmailForApp({ email: 'user@example.com', email_confirmed_at: '2026-10-11T00:00:00Z' }), true);
  assert.equal(hasVerifiedEmailForApp({ email: 'user@example.com', email_confirmed_at: null }), false);
  assert.equal(hasVerifiedEmailForApp({ email: null }), true);
  assert.equal(hasVerifiedEmailForApp(null), false);
});
