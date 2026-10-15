// -----------------------------------------------------------------------------
// The Winix protocol pieces, without Gladys: the Cognito SRP exchange (checked
// by a server-side computation), the encrypted mobile API and the device API.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  G,
  K,
  N,
  claimSignature,
  cognitoTimestamp,
  createSrpSession,
  derivedKey,
  modPow,
  padHex,
  passwordExponent,
  scrambler,
} from '../src/winix/srp.js';
import * as cognito from '../src/winix/cognito.js';
import { clientUuid, decrypt, encrypt, mobilePost } from '../src/winix/mobile.js';
import { COOLDOWN_MS, createDeviceApi } from '../src/winix/device-api.js';
import {
  WinixAuthError,
  WinixOfflineError,
  WinixRateLimitError,
  WinixRefreshExpiredError,
  WinixSessionError,
  WinixUnavailableError,
} from '../src/winix/errors.js';
import { createFakeWinix, fixture, PASSWORD, USERNAME, USER_SUB } from './helpers/fakeWinix.js';

test('padHex follows the Cognito rule: even length, 00 before a high first digit', () => {
  assert.equal(padHex(0xfn), '0f');
  assert.equal(padHex(0x7fn), '7f');
  assert.equal(padHex(0x80n), '0080');
  assert.equal(padHex(0x123n), '0123');
  assert.equal(padHex('abcd'), '00abcd');
});

test('the Cognito timestamp does not pad the day', () => {
  assert.equal(
    cognitoTimestamp(new Date(Date.UTC(2026, 9, 5, 9, 5, 3))),
    'Mon Oct 5 09:05:03 UTC 2026',
  );
  assert.equal(
    cognitoTimestamp(new Date(Date.UTC(2026, 9, 15, 23, 59, 0))),
    'Thu Oct 15 23:59:00 UTC 2026',
  );
});

test('the SRP claim is the one a Cognito server computes from the password', () => {
  const poolName = 'Ofd50EosD';
  const userId = USER_SUB;
  const saltHex = randomBytes(16).toString('hex');
  const v = modPow(G, passwordExponent({ poolName, userId, password: PASSWORD, saltHex }), N);
  const b = BigInt(`0x${randomBytes(64).toString('hex')}`) % N;
  const B = (K * v + modPow(G, b, N)) % N;
  const secretBlock = randomBytes(32).toString('base64');

  const session = createSrpSession();
  const answer = session.answer({
    poolId: `us-east-1_${poolName}`,
    userId,
    password: PASSWORD,
    saltHex,
    srpBHex: B.toString(16),
    secretBlock,
  });

  const A = BigInt(`0x${session.srpA}`);
  const u = scrambler(A, B);
  const S = modPow(A * modPow(v, u, N), b, N);
  const expected = claimSignature({
    key: derivedKey(S, u),
    poolName,
    userId,
    secretBlock,
    timestamp: answer.TIMESTAMP,
  });
  assert.equal(answer.PASSWORD_CLAIM_SIGNATURE, expected);
  assert.equal(answer.USERNAME, userId);
  assert.equal(answer.PASSWORD_CLAIM_SECRET_BLOCK, secretBlock);

  // The wrong password gives another signature.
  const wrong = createSrpSession().answer({
    poolId: `us-east-1_${poolName}`,
    userId,
    password: 'not the password',
    saltHex,
    srpBHex: B.toString(16),
    secretBlock,
  });
  assert.notEqual(wrong.PASSWORD_CLAIM_SIGNATURE, expected);
});

test('an SRP_B of zero is refused', () => {
  assert.throws(
    () =>
      createSrpSession().answer({
        poolId: 'us-east-1_x',
        userId: 'u',
        password: 'p',
        saltHex: '01',
        srpBHex: N.toString(16),
        secretBlock: '',
      }),
    /Invalid SRP_B/,
  );
});

test('sign-in, refresh and identity against the fake Cognito', async () => {
  const winix = createFakeWinix();
  const tokens = await cognito.login({
    fetch: winix.fetch,
    username: USERNAME,
    password: PASSWORD,
  });
  assert.ok(tokens.accessToken && tokens.idToken && tokens.refreshToken);
  assert.equal(cognito.tokenSubject(tokens.accessToken), USER_SUB);
  assert.ok(tokens.expiresAt > Date.now());

  const refreshed = await cognito.refresh({
    fetch: winix.fetch,
    refreshToken: tokens.refreshToken,
  });
  assert.notEqual(refreshed.accessToken, tokens.accessToken);
  assert.equal(refreshed.refreshToken, tokens.refreshToken, 'the refresh token is kept');

  const identityId = await cognito.getIdentityId({
    fetch: winix.fetch,
    idToken: refreshed.idToken,
  });
  assert.match(identityId, /^us-east-1:/);
});

test('a wrong password or an unknown account is a credentials refusal', async () => {
  const winix = createFakeWinix();
  for (const [username, password] of [
    [USERNAME, 'wrong'],
    ['nobody@example.com', PASSWORD],
  ]) {
    await assert.rejects(
      cognito.login({ fetch: winix.fetch, username, password }),
      (err) => err instanceof WinixAuthError && err.reason === 'credentials',
    );
  }
});

test('a revoked refresh token asks for a full sign-in', async () => {
  const winix = createFakeWinix();
  const tokens = await cognito.login({
    fetch: winix.fetch,
    username: USERNAME,
    password: PASSWORD,
  });
  winix.state.refreshRevoked = true;
  await assert.rejects(
    cognito.refresh({ fetch: winix.fetch, refreshToken: tokens.refreshToken }),
    WinixRefreshExpiredError,
  );
});

test('Cognito errors map to what the integration does about them', async () => {
  const answer = (status, body) => async () =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const login = (fetchImpl) => cognito.login({ fetch: fetchImpl, username: 'a', password: 'b' });
  await assert.rejects(
    login(answer(400, { __type: 'PasswordResetRequiredException', message: 'x' })),
    (err) => err.reason === 'password_reset',
  );
  await assert.rejects(
    login(answer(400, { __type: 'UserNotConfirmedException', message: 'x' })),
    (err) => err.reason === 'not_confirmed',
  );
  await assert.rejects(
    login(answer(400, { __type: 'TooManyRequestsException', message: 'x' })),
    WinixRateLimitError,
  );
  await assert.rejects(login(answer(503, {})), WinixUnavailableError);
  await assert.rejects(
    login(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    }),
    (err) => err instanceof WinixUnavailableError && /ENOTFOUND/.test(err.message),
  );
});

test('mobile payloads are AES encrypted both ways', () => {
  const payload = { accessToken: 'token', uuid: 'abc', é: 'ü' };
  const data = encrypt(payload);
  assert.ok(!data.toString('utf8').includes('token'));
  assert.deepEqual(decrypt(data), payload);
});

test('the client uuid is stable, 16 hex digits, and our own', () => {
  assert.match(clientUuid(USER_SUB), /^[0-9a-f]{16}$/);
  assert.equal(clientUuid(USER_SUB), clientUuid(USER_SUB));
  assert.notEqual(clientUuid(USER_SUB), clientUuid('another-user'));
});

test('mobile errors: a taken session, an unreadable answer, a refusal', async () => {
  const reply = (status, body) => async () =>
    new Response(body === null ? Buffer.from('<html>') : encrypt(body), { status });
  await assert.rejects(
    mobilePost(
      reply(400, { resultCode: '900', resultMessage: 'MULTI LOGIN' }),
      'getDeviceInfoList',
      {},
    ),
    WinixSessionError,
  );
  await assert.rejects(mobilePost(reply(502, null), 'init', {}), /HTTP 502/);
  await assert.rejects(
    mobilePost(
      reply(200, { resultCode: '403', resultMessage: 'invalid access token' }),
      'init',
      {},
    ),
    WinixUnavailableError,
  );
  assert.deepEqual(await mobilePost(reply(200, { resultCode: '200', x: 1 }), 'init', {}), {
    resultCode: '200',
    x: 1,
  });
});

test('device API: state, offline purifier, rate limit and its cooldown', async () => {
  let now = 1_000_000;
  const winix = createFakeWinix();
  const api = createDeviceApi({ fetch: winix.fetch, now: () => now, sleep: async () => {} });

  assert.deepEqual(
    await api.getAttributes('0A1B2C3D4E5F_zq7wk2m4x9'),
    fixture('status-c545').body.data[0].attributes,
  );

  winix.state.offline.add('0A1B2C3D4E5F_zq7wk2m4x9');
  await assert.rejects(api.getAttributes('0A1B2C3D4E5F_zq7wk2m4x9'), WinixOfflineError);

  winix.state.rateLimited = true;
  await assert.rejects(api.getAttributes('0A1B2C3D4E60_pk3rt8v1c6'), WinixRateLimitError);
  const requests = winix.state.calls.length;
  winix.state.rateLimited = false;
  await assert.rejects(api.getAttributes('0A1B2C3D4E60_pk3rt8v1c6'), WinixRateLimitError);
  assert.equal(winix.state.calls.length, requests, 'no request during the cooldown');
  now += COOLDOWN_MS;
  assert.equal((await api.getAttributes('0A1B2C3D4E60_pk3rt8v1c6')).S04, '12');
});

test('device API: a control 503 is retried once; errors never show the URL', async () => {
  const urls = [];
  let failures = 1;
  const fetchImpl = async (url) => {
    urls.push(url);
    if (failures > 0) {
      failures -= 1;
      return new Response('', { status: 503 });
    }
    return new Response(JSON.stringify({ headers: { resultMessage: '' } }), { status: 200 });
  };
  const api = createDeviceApi({ fetch: fetchImpl, sleep: async () => {} });
  await api.setAttribute('DEVICE_1', 'us-east-1:secret-identity', 'A02', '1');
  assert.equal(urls.length, 2);
  assert.match(
    urls[0],
    /\/common\/control\/devices\/DEVICE_1\/us-east-1%3Asecret-identity\/A02:1$/,
  );

  failures = 2;
  await assert.rejects(
    api.setAttribute('DEVICE_1', 'us-east-1:secret-identity', 'A02', '1'),
    (err) => err instanceof WinixUnavailableError && !err.message.includes('secret-identity'),
  );
});
