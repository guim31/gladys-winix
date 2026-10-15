// -----------------------------------------------------------------------------
// The Winix device API (us.api.winix-iot.com): read the state of a purifier,
// and set one attribute.
//
// Reading needs only the device id; controlling needs the Cognito identity id
// of the account in the URL. Neither needs the mobile session, which the phone
// app and this integration take from each other (see src/winix/account.js).
//
// The API answers 403 or 429 to a burst of requests and stays closed about a
// minute: after one, the client waits COOLDOWN_MS before asking again.
// -----------------------------------------------------------------------------

import { request } from './http.js';
import { WinixOfflineError, WinixRateLimitError, WinixUnavailableError } from './errors.js';

export const API_URL = 'https://us.api.winix-iot.com';
export const COOLDOWN_MS = 60_000;

// The answers that mean "this purifier cannot be reached", not "the cloud is down".
const OFFLINE_MESSAGES = new Set([
  'no data',
  'device not connected',
  'device not registered',
  'parameter(s) not valid : device id',
]);

/**
 * @param {object} options
 * @param {typeof fetch} options.fetch
 * @param {() => number} [options.now]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 */
export function createDeviceApi({ fetch: fetchImpl, now = Date.now, sleep = defaultSleep }) {
  let cooldownUntil = 0;

  async function get(url, label) {
    if (now() < cooldownUntil) {
      throw new WinixRateLimitError(`${label}: waiting after a rate limit`);
    }
    const response = await request(fetchImpl, url, { label, method: 'GET' });
    if (response.status === 403 || response.status === 429) {
      cooldownUntil = now() + COOLDOWN_MS;
      throw new WinixRateLimitError(`${label}: HTTP ${response.status}`);
    }
    if (!response.ok) {
      throw new WinixUnavailableError(`${label}: HTTP ${response.status}`);
    }
    let json;
    try {
      json = await response.json();
    } catch {
      throw new WinixUnavailableError(`${label}: unreadable answer`);
    }
    const message = json?.headers?.resultMessage;
    if (typeof message !== 'string') {
      throw new WinixUnavailableError(`${label}: answer without result message`);
    }
    if (OFFLINE_MESSAGES.has(message.toLowerCase())) {
      throw new WinixOfflineError(`${label}: ${message}`);
    }
    return json;
  }

  return {
    /**
     * The raw attributes of the purifier ({ A02: '1', S08: '74'... }).
     * @param {string} deviceId
     * @throws {WinixOfflineError} the cloud has nothing for it
     */
    async getAttributes(deviceId) {
      const json = await get(
        `${API_URL}/common/event/sttus/devices/${encodeURIComponent(deviceId)}`,
        'Winix status',
      );
      const attributes = json?.body?.data?.[0]?.attributes;
      if (!attributes || typeof attributes !== 'object' || Object.keys(attributes).length === 0) {
        throw new WinixOfflineError('Winix status: no attributes');
      }
      return attributes;
    },

    /**
     * Set one attribute (A02 power, A03 mode, A04 airflow, A07 Plasmawave).
     * A 500 or 503 is retried once after a second, as the cloud often answers
     * one when the purifier is slow to acknowledge.
     */
    async setAttribute(deviceId, identityId, attribute, value) {
      const url =
        `${API_URL}/common/control/devices/${encodeURIComponent(deviceId)}/` +
        `${encodeURIComponent(identityId)}/${attribute}:${value}`;
      try {
        await get(url, 'Winix control');
      } catch (err) {
        if (!(err instanceof WinixUnavailableError) || !/HTTP 50[03]$/.test(err.message)) {
          throw err;
        }
        await sleep(1000);
        await get(url, 'Winix control');
      }
    },

    /** Milliseconds left before the API is asked again after a rate limit. */
    cooldownRemaining() {
      return Math.max(0, cooldownUntil - now());
    },
  };
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
