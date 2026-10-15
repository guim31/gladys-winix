#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Probe of the real Winix cloud, read-only, with a FAKE account.
//
//   node scripts/probe.mjs
//
// Runs the integration's own client code against the real endpoints until a
// refusal, and checks each refusal is the expected one:
//   1. Cognito sign-in (SRP) with an invented e-mail: refused as credentials;
//   2. Cognito refresh with an invented refresh token: refused;
//   3. the encrypted mobile API with an invented token: a refusal that
//      decrypts, which proves the AES key and IV are still the app's;
//   4. the device API with an invented device id: "no data" (read-only).
//
// Nothing sensitive is printed: no token, no password (all invented anyway),
// only endpoint names, HTTP statuses and error codes. No Winix account and no
// purifier is touched. Exit code 0 when every step answered as expected.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import * as cognito from '../src/winix/cognito.js';
import { MOBILE_URL, decrypt, encrypt } from '../src/winix/mobile.js';
import { createDeviceApi } from '../src/winix/device-api.js';
import {
  WinixAuthError,
  WinixOfflineError,
  WinixRefreshExpiredError,
} from '../src/winix/errors.js';

const fakeEmail = `gladys-winix-probe-${randomBytes(6).toString('hex')}@example.invalid`;
const fakePassword = randomBytes(18).toString('base64url');
const results = [];

async function step(name, run) {
  const started = Date.now();
  try {
    const outcome = await run();
    results.push({ name, ok: true, outcome });
    console.log(`OK    ${name}: ${outcome} (${Date.now() - started} ms)`);
  } catch (err) {
    results.push({ name, ok: false, outcome: err.message });
    console.log(`FAIL  ${name}: ${err.message} (${Date.now() - started} ms)`);
  }
}

await step('Cognito sign-in (SRP) with a fake account', async () => {
  try {
    await cognito.login({ fetch, username: fakeEmail, password: fakePassword });
  } catch (err) {
    if (err instanceof WinixAuthError && err.reason === 'credentials') {
      return `refused as expected (${err.code})`;
    }
    throw new Error(`unexpected answer: ${err.name} ${err.message}`, { cause: err });
  }
  throw new Error('a fake account was accepted?!');
});

await step('Cognito refresh with a fake refresh token', async () => {
  try {
    await cognito.refresh({ fetch, refreshToken: randomBytes(32).toString('hex') });
  } catch (err) {
    if (err instanceof WinixRefreshExpiredError) {
      return `refused as expected (${err.code})`;
    }
    throw new Error(`unexpected answer: ${err.name} ${err.message}`, { cause: err });
  }
  throw new Error('a fake refresh token was accepted?!');
});

await step('Winix mobile API (AES) with a fake token', async () => {
  const response = await fetch(`${MOBILE_URL}/getDeviceInfoList`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', Accept: 'application/octet-stream' },
    body: encrypt({ accessToken: 'probe', uuid: '0000000000000000' }),
    signal: AbortSignal.timeout(15_000),
  });
  const raw = Buffer.from(await response.arrayBuffer());
  let body;
  try {
    body = decrypt(raw);
  } catch {
    throw new Error(
      `HTTP ${response.status}, ${raw.length} bytes that do not decrypt: key or IV changed?`,
    );
  }
  return `HTTP ${response.status}, decrypted result code ${body.resultCode ?? '-'} "${String(body.resultMessage ?? '').slice(0, 60)}"`;
});

await step('Winix device API, state of a fake device id', async () => {
  const api = createDeviceApi({ fetch });
  try {
    const attributes = await api.getAttributes(`000000000000_${randomBytes(5).toString('hex')}`);
    return `answered attributes ${Object.keys(attributes).join(',')}?!`;
  } catch (err) {
    if (err instanceof WinixOfflineError) {
      return `no data, as expected (${err.message})`;
    }
    throw err;
  }
});

const failed = results.filter((result) => !result.ok);
console.log(
  failed.length === 0 ? '\nAll steps answered as expected.' : `\n${failed.length} step(s) failed.`,
);
process.exit(failed.length === 0 ? 0 : 1);
