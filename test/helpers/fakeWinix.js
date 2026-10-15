// -----------------------------------------------------------------------------
// A fake Winix cloud, behind a `fetch` function: Cognito (the server side of
// the SRP exchange, refresh, identity pool), the encrypted mobile API (one
// session per account, taken by the last sign-in) and the device API (state
// and control). Its answers are the fixtures of test/fixtures/winix.
//
// It checks what the real cloud checks: an SRP signature computed from the
// right password, a known access token, the session of the client asking for
// the device list, the identity id of the control URL.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  G,
  K,
  N,
  claimSignature,
  derivedKey,
  modPow,
  passwordExponent,
  scrambler,
} from '../../src/winix/srp.js';
import { CLIENT_ID, IDENTITY_POOL_ID, USER_POOL_ID } from '../../src/winix/cognito.js';
import { decrypt, encrypt } from '../../src/winix/mobile.js';

export const USERNAME = 'jane@example.com';
export const PASSWORD = 'correct horse battery staple';
export const USER_SUB = '3f0c9a52-7d1e-4b7a-9d55-2c1f0e6a8b11';
export const IDENTITY_ID = 'us-east-1:0d7c2a3e-0000-4000-8000-00000000c0de';

export function fixture(name) {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/winix/${name}.json`, import.meta.url), 'utf8'),
  );
}

function fakeJwt(claims) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'RS256', kid: 'fake' })}.${part(claims)}.${randomBytes(16).toString('base64url')}`;
}

/**
 * @param {object} [options]
 * @param {() => number} [options.now]
 */
export function createFakeWinix({ now = Date.now } = {}) {
  const poolName = USER_POOL_ID.split('_')[1];
  const salt = randomBytes(16).toString('hex');
  const user = { username: USERNAME, password: PASSWORD, sub: USER_SUB };
  const verifier = () =>
    modPow(
      G,
      passwordExponent({ poolName, userId: user.sub, password: user.password, saltHex: salt }),
      N,
    );

  const srpChallenges = new Map();
  const accessTokens = new Set();
  const idTokens = new Set();
  const refreshTokens = new Set();

  // Purifier states, by device id, from the fixtures.
  const deviceInfoList = fixture('device-info-list');
  const attributes = new Map([
    ['0A1B2C3D4E5F_zq7wk2m4x9', { ...fixture('status-c545').body.data[0].attributes }],
    ['0A1B2C3D4E60_pk3rt8v1c6', { ...fixture('status-pm25').body.data[0].attributes }],
    ['0A1B2C3D4E61_dh5yu2n8q3', { D02: '1', D10: '55' }],
  ]);

  const state = {
    calls: [],
    controls: [],
    signIns: 0,
    refreshes: 0,
    /** The uuid of the client holding the mobile session. */
    sessionUuid: null,
    offline: new Set(),
    rateLimited: false,
    down: false,
    refreshRevoked: false,
  };

  const json = (status, body) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  const amzError = (type, message) => json(400, { __type: type, message });
  const encrypted = (status, body) => new Response(encrypt(body), { status });

  function issueTokens({ withRefresh }) {
    const exp = Math.floor(now() / 1000) + 3600;
    const accessToken = fakeJwt({ sub: user.sub, token_use: 'access', exp });
    const idToken = fakeJwt({ sub: user.sub, token_use: 'id', exp, email: user.username });
    accessTokens.add(accessToken);
    idTokens.add(idToken);
    const result = {
      AccessToken: accessToken,
      IdToken: idToken,
      ExpiresIn: 3600,
      TokenType: 'Bearer',
    };
    if (withRefresh) {
      const refreshToken = `refresh-${randomBytes(24).toString('hex')}`;
      refreshTokens.add(refreshToken);
      result.RefreshToken = refreshToken;
    }
    return result;
  }

  function cognitoIdp(target, body) {
    if (body.ClientId !== CLIENT_ID) {
      return amzError('ResourceNotFoundException', 'User pool client does not exist.');
    }
    if (target === 'AWSCognitoIdentityProviderService.InitiateAuth') {
      if (body.AuthFlow === 'USER_SRP_AUTH') {
        if (body.AuthParameters.USERNAME.toLowerCase() !== user.username) {
          return amzError('UserNotFoundException', 'User does not exist.');
        }
        const b = BigInt(`0x${randomBytes(64).toString('hex')}`) % N;
        const B = (K * verifier() + modPow(G, b, N)) % N;
        const secretBlock = randomBytes(32).toString('base64');
        srpChallenges.set(secretBlock, { A: BigInt(`0x${body.AuthParameters.SRP_A}`), b, B });
        return json(200, {
          ChallengeName: 'PASSWORD_VERIFIER',
          ChallengeParameters: {
            SALT: salt,
            SRP_B: B.toString(16),
            SECRET_BLOCK: secretBlock,
            USER_ID_FOR_SRP: user.sub,
            USERNAME: user.sub,
          },
        });
      }
      if (body.AuthFlow === 'REFRESH_TOKEN_AUTH') {
        if (state.refreshRevoked || !refreshTokens.has(body.AuthParameters.REFRESH_TOKEN)) {
          return amzError('NotAuthorizedException', 'Invalid Refresh Token');
        }
        state.refreshes += 1;
        return json(200, { AuthenticationResult: issueTokens({ withRefresh: false }) });
      }
      return amzError('InvalidParameterException', 'Unsupported flow');
    }
    if (target === 'AWSCognitoIdentityProviderService.RespondToAuthChallenge') {
      const answer = body.ChallengeResponses;
      const challenge = srpChallenges.get(answer.PASSWORD_CLAIM_SECRET_BLOCK);
      srpChallenges.delete(answer.PASSWORD_CLAIM_SECRET_BLOCK);
      if (!challenge) {
        return amzError('NotAuthorizedException', 'Incorrect username or password.');
      }
      const { A, b, B } = challenge;
      const u = scrambler(A, B);
      const S = modPow(A * modPow(verifier(), u, N), b, N);
      const expected = claimSignature({
        key: derivedKey(S, u),
        poolName,
        userId: answer.USERNAME,
        secretBlock: answer.PASSWORD_CLAIM_SECRET_BLOCK,
        timestamp: answer.TIMESTAMP,
      });
      if (expected !== answer.PASSWORD_CLAIM_SIGNATURE) {
        return amzError('NotAuthorizedException', 'Incorrect username or password.');
      }
      state.signIns += 1;
      return json(200, { AuthenticationResult: issueTokens({ withRefresh: true }) });
    }
    return amzError('UnknownOperationException', target);
  }

  function cognitoIdentity(body) {
    const logins = Object.values(body.Logins ?? {});
    if (body.IdentityPoolId !== IDENTITY_POOL_ID || !logins.every((token) => idTokens.has(token))) {
      return amzError('NotAuthorizedException', 'Invalid login token.');
    }
    return json(200, { IdentityId: IDENTITY_ID });
  }

  function mobileApi(path, payload) {
    if (!accessTokens.has(payload.accessToken)) {
      return encrypted(400, { resultCode: '400', resultMessage: 'The user is not valid.' });
    }
    switch (path) {
      case '/registerUser':
        if (payload.identityId !== IDENTITY_ID || payload.email !== user.username) {
          return encrypted(400, { resultCode: '401', resultMessage: 'identityId missing' });
        }
        state.sessionUuid = payload.uuid;
        return encrypted(200, { resultCode: '200', resultMessage: '' });
      case '/init':
      case '/checkAccessToken':
        return encrypted(200, { resultCode: '200', resultMessage: '' });
      case '/getDeviceInfoList':
        if (payload.uuid !== state.sessionUuid) {
          return encrypted(400, { resultCode: '900', resultMessage: 'MULTI LOGIN' });
        }
        return encrypted(200, deviceInfoList);
      case '/getAllModelGroupInfoList':
        return encrypted(200, fixture('model-group-info'));
      default:
        return encrypted(404, { resultCode: '404', resultMessage: 'not found' });
    }
  }

  function deviceApi(path) {
    if (state.rateLimited) {
      return new Response('Forbidden', { status: 429 });
    }
    const status = path.match(/^\/common\/event\/sttus\/devices\/([^/]+)$/);
    if (status) {
      const deviceId = decodeURIComponent(status[1]);
      if (state.offline.has(deviceId) || !attributes.has(deviceId)) {
        return json(200, fixture('status-no-data'));
      }
      return json(200, {
        statusCode: 200,
        headers: { resultCode: 'S100', resultMessage: '' },
        body: {
          deviceId,
          totalCnt: 1,
          data: [{ apiNo: 'A210', attributes: { ...attributes.get(deviceId) }, rssi: '-55' }],
        },
      });
    }
    const control = path.match(/^\/common\/control\/devices\/([^/]+)\/([^/]+)\/([A-Z]\d\d):(\w+)$/);
    if (control) {
      const [, rawId, rawIdentity, attribute, value] = control;
      const deviceId = decodeURIComponent(rawId);
      if (decodeURIComponent(rawIdentity) !== IDENTITY_ID) {
        return json(200, {
          statusCode: 200,
          headers: { resultCode: 'F100', resultMessage: 'not authorized' },
        });
      }
      if (state.offline.has(deviceId)) {
        return json(200, {
          statusCode: 200,
          headers: { resultCode: 'S100', resultMessage: 'device not connected' },
          body: {},
        });
      }
      const current = attributes.get(deviceId);
      current[attribute] = value;
      if (attribute === 'A04') {
        current.A03 = '02';
      }
      state.controls.push({ deviceId, attribute, value });
      return json(200, {
        statusCode: 200,
        headers: { resultCode: 'S100', resultMessage: '' },
        body: {},
      });
    }
    return json(404, {});
  }

  async function fetchImpl(url, init = {}) {
    const { host, pathname } = new URL(url);
    if (state.down) {
      const error = new TypeError('fetch failed');
      error.cause = { code: 'ECONNREFUSED' };
      throw error;
    }
    if (host === 'cognito-idp.us-east-1.amazonaws.com') {
      const target = init.headers['X-Amz-Target'];
      state.calls.push({ host, target });
      return cognitoIdp(target, JSON.parse(init.body));
    }
    if (host === 'cognito-identity.us-east-1.amazonaws.com') {
      state.calls.push({ host, target: init.headers['X-Amz-Target'] });
      return cognitoIdentity(JSON.parse(init.body));
    }
    if (host === 'us.mobile.winix-iot.com') {
      state.calls.push({ host, path: pathname });
      return mobileApi(pathname, decrypt(Buffer.from(init.body)));
    }
    if (host === 'us.api.winix-iot.com') {
      state.calls.push({ host, path: pathname });
      return deviceApi(pathname);
    }
    throw new Error(`Unexpected request to ${host}`);
  }

  return {
    fetch: fetchImpl,
    state,
    attributes,
    /** The phone app signs in: it takes the mobile session. */
    phoneSignsIn() {
      state.sessionUuid = 'phone-app-uuid';
    },
    /** How many requests reached a host (and a path or target, optionally). */
    count(host, what) {
      return state.calls.filter(
        (call) =>
          call.host === host && (what === undefined || call.path === what || call.target === what),
      ).length;
    },
    /** Every token and secret this cloud handed out (none may reach the logs). */
    secrets() {
      return [...accessTokens, ...idTokens, ...refreshTokens, IDENTITY_ID, PASSWORD];
    },
  };
}
