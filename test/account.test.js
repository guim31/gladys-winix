// -----------------------------------------------------------------------------
// The Winix account: sign-in once, keep the session in /data, refresh the
// tokens, sign in again when the refresh is refused, never retry a refused
// password, and survive the phone app taking the mobile session.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';
import { accountKey, createAccount } from '../src/winix/account.js';
import { createMemoryStore, createStore } from '../src/store.js';
import { WinixAuthError } from '../src/winix/errors.js';
import { createFakeWinix, IDENTITY_ID, PASSWORD, USERNAME } from './helpers/fakeWinix.js';

const logger = createLogger({ name: 'test', level: 'silent' });
const COGNITO = 'cognito-idp.us-east-1.amazonaws.com';
const MOBILE = 'us.mobile.winix-iot.com';

async function signedIn({ store = createMemoryStore(), winix = createFakeWinix() } = {}) {
  const account = createAccount({ fetch: winix.fetch, store, logger });
  await account.setCredentials({ username: USERNAME, password: PASSWORD });
  return { account, store, winix };
}

test('the first listing signs in and keeps the purifiers only', async () => {
  const { account, winix } = await signedIn();
  assert.equal(account.hasDevices, false);
  const devices = await account.syncDevices();
  assert.equal(winix.state.signIns, 1);
  assert.deepEqual(
    devices.map((d) => [d.alias, d.mac, d.modelId]),
    [
      ['Living room', '0a1b2c3d4e5f', 'C545'],
      ['Bedroom', '0a1b2c3d4e60', 'T810_EU'],
    ],
  );
  assert.equal(account.ignoredCount, 1, 'the dehumidifier is left out');
  assert.equal(account.identityId, IDENTITY_ID);
  assert.equal(account.filterLife.t810_eu, 8640);
  assert.equal(account.hasDevices, true);
});

test('/data keeps the session without the password, the e-mail or short-lived tokens', async () => {
  const { account, store, winix } = await signedIn();
  await account.syncDevices();
  const saved = JSON.stringify(store.peek());
  assert.ok(!saved.includes(PASSWORD));
  assert.ok(!saved.includes(USERNAME));
  assert.equal(store.peek().account, accountKey(USERNAME));
  for (const secret of winix
    .secrets()
    .filter((s) => !s.startsWith('refresh-') && s !== IDENTITY_ID)) {
    assert.ok(!saved.includes(secret), 'no access or id token on disk');
  }
  assert.ok(store.peek().refreshToken.startsWith('refresh-'));
});

test('a restart reads the purifiers from /data: no sign-in, no session', async () => {
  const winix = createFakeWinix();
  const { account, store } = await signedIn({ winix });
  await account.syncDevices();
  const calls = winix.state.calls.length;

  const restarted = createAccount({ fetch: winix.fetch, store, logger });
  await restarted.setCredentials({ username: USERNAME, password: PASSWORD });
  assert.equal(restarted.hasDevices, true);
  assert.equal(restarted.identityId, IDENTITY_ID);
  assert.equal(restarted.devices.length, 2);
  assert.equal(winix.state.calls.length, calls, 'not a single request');
});

test('another account in the configuration drops what /data held', async () => {
  const { account, store, winix } = await signedIn();
  await account.syncDevices();
  const other = createAccount({ fetch: winix.fetch, store, logger });
  await other.setCredentials({ username: 'someone.else@example.com', password: 'x' });
  assert.equal(other.hasDevices, false);
  assert.equal(other.identityId, null);
});

test('a later listing refreshes the tokens instead of signing in', async () => {
  const winix = createFakeWinix();
  const { account, store } = await signedIn({ winix });
  await account.syncDevices();
  const restarted = createAccount({ fetch: winix.fetch, store, logger });
  await restarted.setCredentials({ username: USERNAME, password: PASSWORD });
  await restarted.syncDevices();
  assert.equal(winix.state.signIns, 1);
  assert.equal(winix.state.refreshes, 1);
});

test('a refused refresh falls back to a sign-in with the password', async () => {
  const winix = createFakeWinix();
  const { account, store } = await signedIn({ winix });
  await account.syncDevices();
  winix.state.refreshRevoked = true;
  const restarted = createAccount({ fetch: winix.fetch, store, logger });
  await restarted.setCredentials({ username: USERNAME, password: PASSWORD });
  assert.equal((await restarted.syncDevices()).length, 2);
  assert.equal(winix.state.signIns, 2);
});

test('a refused password is not tried again until the credentials change', async () => {
  const winix = createFakeWinix();
  const account = createAccount({ fetch: winix.fetch, store: createMemoryStore(), logger });
  await account.setCredentials({ username: USERNAME, password: 'wrong' });
  await assert.rejects(account.syncDevices(), WinixAuthError);
  const calls = winix.count(COGNITO);
  await assert.rejects(account.syncDevices(), WinixAuthError);
  assert.equal(winix.count(COGNITO), calls, 'no second attempt: it would lock the account');
  assert.equal(account.authError.reason, 'credentials');

  await account.setCredentials({ username: USERNAME, password: PASSWORD });
  assert.equal(account.authError, null);
  assert.equal((await account.syncDevices()).length, 2);
});

test('the phone app taking the session: a new session is opened, once', async () => {
  const { account, winix } = await signedIn();
  await account.syncDevices();
  winix.phoneSignsIn();
  assert.equal((await account.syncDevices()).length, 2);
  assert.equal(winix.count(MOBILE, '/getDeviceInfoList'), 3, 'refused once, then listed');
});

test('the file store: readable by its owner only, and an unreadable file is no session', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'winix-store-'));
  const store = createStore({ dir });
  assert.equal(await store.load(), null);
  await store.save({ version: 1, account: 'abc' });
  assert.deepEqual(await store.load(), { version: 1, account: 'abc' });
  assert.equal((await stat(store.path)).mode & 0o777, 0o600);
  assert.match(await readFile(store.path, 'utf8'), /"account":"abc"/);
  await writeFile(store.path, '{ half a file');
  assert.equal(await store.load(), null);
});
