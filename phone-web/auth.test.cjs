const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifyUser } = require('./auth.cjs');

test('verification distinguishes unavailable authentication from expired sessions', async t => {
  const mock = t.mock.method(globalThis, 'fetch');
  mock.mock.mockImplementation(async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(verifyUser('network-test'), error =>
    error.statusCode === 503 && /cannot reach Supabase/.test(error.message));
  mock.mock.mockImplementation(async () => ({ ok: false, status: 503 }));
  await assert.rejects(verifyUser('outage-test'), error => error.statusCode === 503);
  mock.mock.mockImplementation(async () => ({ ok: false, status: 401 }));
  await assert.rejects(verifyUser('expired-test'), error =>
    error.statusCode === 401 && /Sign in again/.test(error.message));
});
