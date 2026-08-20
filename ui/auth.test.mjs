import assert from 'node:assert/strict';
import test from 'node:test';
import { cookieValue, isAuthorized, isValidApiKey, sessionCookie, sessionToken } from './auth.mjs';

const key = 'test-api-key-1234567890';

test('validates API keys without accepting prefixes', () => {
  assert.equal(isValidApiKey(key, key), true);
  assert.equal(isValidApiKey('test-api-key', key), false);
});

test('accepts bearer authentication', () => {
  assert.equal(isAuthorized({ headers: { authorization: `Bearer ${key}` } }, key), true);
  assert.equal(isAuthorized({ headers: { authorization: 'Bearer wrong' } }, key), false);
});

test('creates and accepts an HttpOnly session cookie', () => {
  const setCookie = sessionCookie(key);
  const cookie = setCookie.split(';')[0];
  assert.equal(cookieValue(cookie, 'higsgen_session'), sessionToken(key));
  assert.equal(isAuthorized({ headers: { cookie } }, key), true);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
});
