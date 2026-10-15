// -----------------------------------------------------------------------------
// The Winix "mobile" API (us.mobile.winix-iot.com): the session handshake and
// the list of the purifiers of the account.
//
// Since Winix Smart 1.5.6, request and answer bodies are AES-256-CBC encrypted
// with a key and IV shipped in the app (published by the winix projects, see
// the README credits). The answer is encrypted even on an HTTP error, and
// carries `resultCode` / `resultMessage`.
// -----------------------------------------------------------------------------

import { createCipheriv, createDecipheriv } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { request } from './http.js';
import { WinixSessionError, WinixUnavailableError } from './errors.js';

export const MOBILE_URL = 'https://us.mobile.winix-iot.com';

const AES_KEY = Buffer.from(
  '84be38f854e320dd4a0a8c7fe0f3a9b84c288445916933fc222465bbd5a518d0',
  'hex',
);
const AES_IV = Buffer.from('dfd55f316e72e97b905f8739005c99a7', 'hex');

/** What the app tells the server about itself: the session handshake checks it. */
export const APP_METADATA = {
  osType: 'android',
  osVersion: '29',
  mobileLang: 'en',
  appVersion: '1.5.7',
  mobileModel: 'SM-G988B',
};

/** @param {object} payload @returns {Buffer} */
export function encrypt(payload) {
  const cipher = createCipheriv('aes-256-cbc', AES_KEY, AES_IV);
  return Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
}

/** @param {Buffer} data @returns {object} the decrypted JSON */
export function decrypt(data) {
  const decipher = createDecipheriv('aes-256-cbc', AES_KEY, AES_IV);
  const text = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  return JSON.parse(text);
}

/**
 * The "secure Android id" the server registers for this client: derived from
 * the account user id, so it stays the same across restarts, and distinct
 * from the ids the phone app and the other projects use.
 * @param {string} userId the `sub` of the Cognito access token
 */
export function clientUuid(userId) {
  const hex = (text) => crc32(Buffer.from(text, 'utf8')).toString(16).padStart(8, '0');
  return `${hex(`github.com/guim31/gladys-winix${userId}`)}${hex(`HGF${userId}`)}`;
}

/**
 * POST an encrypted payload, return the decrypted answer.
 * @throws {WinixSessionError} result code 400 / 900: the session is gone
 * @throws {WinixUnavailableError} anything else
 */
export async function mobilePost(fetchImpl, path, payload) {
  const label = `Winix ${path}`;
  const response = await request(fetchImpl, `${MOBILE_URL}/${path}`, {
    label,
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      Accept: 'application/octet-stream',
    },
    body: encrypt(payload),
  });
  const raw = Buffer.from(await response.arrayBuffer());
  let body;
  try {
    body = raw.length > 0 ? decrypt(raw) : undefined;
  } catch {
    body = undefined;
  }
  const code = body?.resultCode;
  if (response.status !== 200) {
    if (response.status === 400 && (code === '400' || code === '900')) {
      throw new WinixSessionError(`${label}: result code ${code}`, { code });
    }
    throw new WinixUnavailableError(
      `${label}: HTTP ${response.status}, result code ${code ?? '-'}`,
      {
        code,
      },
    );
  }
  if (body === undefined) {
    throw new WinixUnavailableError(`${label}: unreadable answer`);
  }
  if (code !== undefined && String(code) !== '200') {
    throw new WinixUnavailableError(`${label}: result code ${code}`, { code });
  }
  return body;
}

/**
 * The handshake that follows a sign-in or a token refresh, in the order the
 * app performs it (1.5.7): registerUser, init, checkAccessToken.
 */
export async function establishSession(fetchImpl, { accessToken, uuid, email, identityId }) {
  await mobilePost(fetchImpl, 'registerUser', {
    accessToken,
    uuid,
    email,
    identityId,
    ...APP_METADATA,
  });
  await mobilePost(fetchImpl, 'init', { accessToken, uuid, region: 'US' });
  await mobilePost(fetchImpl, 'checkAccessToken', {
    accessToken,
    uuid,
    identityId,
    ...APP_METADATA,
  });
}

/**
 * The devices of the account, as the app lists them.
 * @returns {Promise<object[]>} raw `deviceInfoList` entries
 */
export async function getDeviceInfoList(fetchImpl, { accessToken, uuid }) {
  const body = await mobilePost(fetchImpl, 'getDeviceInfoList', { accessToken, uuid });
  return Array.isArray(body.deviceInfoList) ? body.deviceInfoList : [];
}

/**
 * The filter life of every model, in hours (`filterMaxLife`), by lowercased
 * model id. Optional: an empty object when the server does not answer.
 */
export async function getFilterMaxLife(fetchImpl, { accessToken, uuid }) {
  const body = await mobilePost(fetchImpl, 'getAllModelGroupInfoList', { accessToken, uuid });
  const result = {};
  for (const group of body.modelGroupInfoList ?? []) {
    for (const model of group.modelInfoList ?? []) {
      const life = Number(model.filterInfoList?.[0]?.filterMaxLife);
      if (typeof model.modelId === 'string' && Number.isFinite(life) && life > 0) {
        result[model.modelId.toLowerCase()] = life;
      }
    }
  }
  return result;
}
