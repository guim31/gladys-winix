// -----------------------------------------------------------------------------
// The Winix account: signing in, keeping the session, listing the purifiers.
//
// Winix keeps one mobile session per account: when this integration signs in,
// the phone app may be logged out, and when the phone signs in again, the
// integration's session ends ("MULTI LOGIN", result code 900). Reading and
// controlling a purifier do not need that session — only the device id and
// the identity id of the account, which never changes. So the integration
// opens a session only to list the purifiers (first start, a new scan), and
// keeps the identity id, the refresh token and the list in /data: a restart
// does not sign in again, and the phone app is left alone.
//
// Token handling, the fragile part of the Home Assistant integration:
//   - an access token within 5 minutes of expiry is refreshed first;
//   - a refused refresh (expired or revoked, 30 days by default) falls back to
//     a full sign-in with the configured password;
//   - a refused password stops every sign-in until the credentials change in
//     the configuration: retrying would only lock the account.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import * as cognito from './cognito.js';
import * as mobile from './mobile.js';
import { WinixAuthError, WinixRefreshExpiredError, WinixSessionError } from './errors.js';

const EXPIRY_MARGIN_MS = 5 * 60 * 1000;
const STORE_VERSION = 1;

/** A stable key for the account, without keeping the e-mail itself on disk. */
export function accountKey(username) {
  return createHash('sha256')
    .update(
      String(username ?? '')
        .trim()
        .toLowerCase(),
    )
    .digest('hex');
}

/** The useful part of a `deviceInfoList` entry. */
export function normalizeDeviceInfo(entry) {
  return {
    deviceId: String(entry.deviceId ?? ''),
    mac: String(entry.mac ?? '').toLowerCase(),
    alias: String(entry.deviceAlias ?? '').trim(),
    modelId: String(entry.modelId ?? ''),
    modelName: String(entry.modelName ?? '').trim(),
    firmware: String(entry.mcuVer ?? ''),
    productGroup: String(entry.productGroup ?? ''),
  };
}

/** Air purifiers only: dehumidifiers ("Deh…") and air conditioners ("Acn…") are other products. */
export function isAirPurifier(device) {
  return /^air/i.test(device.productGroup);
}

/**
 * @param {object} options
 * @param {typeof fetch} options.fetch
 * @param {{ load: Function, save: Function }} options.store
 * @param {{ info: Function, debug: Function }} options.logger
 * @param {() => number} [options.now]
 * @param {() => object} [options.srp] SRP session factory (tests)
 */
export function createAccount({ fetch: fetchImpl, store, logger, now = Date.now, srp }) {
  let credentials = { username: '', password: '' };
  let data = emptyData('');
  // The mobile session lives in memory only: a restart does not need it.
  let sessionReady = false;
  // A refused password, kept until the credentials change.
  let authError = null;

  function emptyData(key) {
    return {
      version: STORE_VERSION,
      account: key,
      userId: null,
      refreshToken: null,
      identityId: null,
      devices: [],
      ignored: 0,
      filterLife: {},
      attributes: {},
    };
  }

  // Short-lived tokens stay in memory: only what survives a restart is saved.
  let tokens = { accessToken: null, idToken: null, expiresAt: 0 };

  async function persist() {
    await store.save(data);
  }

  async function signIn() {
    if (authError) {
      throw authError;
    }
    try {
      const result = await cognito.login({
        fetch: fetchImpl,
        username: credentials.username,
        password: credentials.password,
        now,
        srp: srp?.(),
      });
      logger.info('Signed in to the Winix account');
      return result;
    } catch (err) {
      if (err instanceof WinixAuthError) {
        authError = err;
      }
      throw err;
    }
  }

  /** Valid access and id tokens: refreshed, or signed in again. */
  async function ensureTokens({ fullLogin = false } = {}) {
    if (!fullLogin && tokens.accessToken && tokens.expiresAt - EXPIRY_MARGIN_MS > now()) {
      return;
    }
    let result = null;
    if (!fullLogin && data.refreshToken) {
      try {
        result = await cognito.refresh({ fetch: fetchImpl, refreshToken: data.refreshToken, now });
        logger.debug('Winix tokens refreshed');
      } catch (err) {
        if (!(err instanceof WinixRefreshExpiredError)) {
          throw err;
        }
        logger.info('The Winix session expired: signing in again');
      }
    }
    if (result === null) {
      result = await signIn();
    }
    tokens = {
      accessToken: result.accessToken,
      idToken: result.idToken,
      expiresAt: result.expiresAt,
    };
    data.refreshToken = result.refreshToken;
    data.userId = cognito.tokenSubject(result.accessToken);
  }

  /** Tokens, identity id and the mobile handshake. */
  async function openSession({ fullLogin = false } = {}) {
    if (sessionReady && !fullLogin && tokens.expiresAt - EXPIRY_MARGIN_MS > now()) {
      return;
    }
    sessionReady = false;
    await ensureTokens({ fullLogin });
    try {
      data.identityId = await cognito.getIdentityId({ fetch: fetchImpl, idToken: tokens.idToken });
    } catch (err) {
      if (!(err instanceof WinixRefreshExpiredError)) {
        throw err;
      }
      // The id token was refused: start again from a full sign-in.
      await ensureTokens({ fullLogin: true });
      data.identityId = await cognito.getIdentityId({ fetch: fetchImpl, idToken: tokens.idToken });
    }
    await mobile.establishSession(fetchImpl, {
      accessToken: tokens.accessToken,
      uuid: mobile.clientUuid(data.userId),
      email: credentials.username,
      identityId: data.identityId,
    });
    sessionReady = true;
    await persist();
  }

  /** Run a mobile call in a session; a session taken by the phone is opened again once. */
  async function withSession(call) {
    for (const fullLogin of [false, true]) {
      try {
        await openSession({ fullLogin: fullLogin });
        return await call({
          accessToken: tokens.accessToken,
          uuid: mobile.clientUuid(data.userId),
        });
      } catch (err) {
        if (!(err instanceof WinixSessionError) || fullLogin) {
          throw err;
        }
        logger.debug('Winix mobile session taken by another sign-in: opening a new one');
        sessionReady = false;
      }
    }
    return undefined;
  }

  return {
    /**
     * Load what /data holds for these credentials. Another account's data
     * is dropped; a password change clears a previous refusal.
     */
    async setCredentials({ username, password }) {
      const changed = username !== credentials.username || password !== credentials.password;
      credentials = { username: username ?? '', password: password ?? '' };
      if (!changed) {
        return;
      }
      authError = null;
      sessionReady = false;
      tokens = { accessToken: null, idToken: null, expiresAt: 0 };
      const key = accountKey(username);
      const saved = await store.load();
      data =
        saved && saved.version === STORE_VERSION && saved.account === key
          ? { ...emptyData(key), ...saved }
          : emptyData(key);
    },

    /** The refusal of the credentials, if any (waits for new ones). */
    get authError() {
      return authError;
    },

    /** The identity id, null before the first sign-in. */
    get identityId() {
      return data.identityId;
    },

    /** The purifiers known from the last listing (also from /data after a restart). */
    get devices() {
      return data.devices;
    },

    /** How many devices of the account are not air purifiers (not supported). */
    get ignoredCount() {
      return data.ignored;
    },

    /** Filter life by lowercased model id, as the cloud sent it. */
    get filterLife() {
      return data.filterLife;
    },

    /** Whether the purifiers were listed at least once. */
    get hasDevices() {
      return data.identityId !== null && data.refreshToken !== null;
    },

    /**
     * List the purifiers of the account (opens a session, may sign in).
     * @returns {Promise<object[]>}
     */
    async syncDevices() {
      const list = await withSession((session) => mobile.getDeviceInfoList(fetchImpl, session));
      const all = list.map(normalizeDeviceInfo).filter((device) => device.deviceId && device.mac);
      data.devices = all.filter(isAirPurifier);
      data.ignored = all.length - data.devices.length;
      if (Object.keys(data.filterLife).length === 0 && data.devices.length > 0) {
        try {
          data.filterLife = await withSession((session) =>
            mobile.getFilterMaxLife(fetchImpl, session),
          );
        } catch (err) {
          // Optional: the built-in table covers the known models.
          logger.debug(`Filter life table unavailable (${err.message})`);
        }
      }
      await persist();
      return data.devices;
    },

    /** The attribute codes a purifier reported last (they decide its features). */
    attributeKeys(deviceId) {
      return data.attributes[deviceId] ?? null;
    },

    /**
     * Remember the attribute codes a purifier reports.
     * @returns {Promise<boolean>} true when they changed
     */
    async rememberAttributeKeys(deviceId, keys) {
      const sorted = [...keys].sort();
      if (JSON.stringify(data.attributes[deviceId] ?? null) === JSON.stringify(sorted)) {
        return false;
      }
      data.attributes[deviceId] = sorted;
      await persist();
      return true;
    },
  };
}
