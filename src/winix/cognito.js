// -----------------------------------------------------------------------------
// AWS Cognito, where Winix accounts live: sign-in (SRP), token refresh, and
// the identity id the device API wants in its control URL.
//
// Plain JSON calls to the public Cognito endpoints, unsigned like the Winix
// app's: no AWS credentials, no AWS SDK. The app client is public (no client
// secret) since Winix rotated it on 2026-04-16 (Winix Smart 1.5.7).
// -----------------------------------------------------------------------------

import { createSrpSession } from './srp.js';
import { request } from './http.js';
import {
  WinixAuthError,
  WinixRateLimitError,
  WinixRefreshExpiredError,
  WinixUnavailableError,
} from './errors.js';

export const REGION = 'us-east-1';
export const USER_POOL_ID = 'us-east-1_Ofd50EosD';
export const CLIENT_ID = '5rjk59c5tt7k9g8gpj0vd2qfg9';
export const IDENTITY_POOL_ID = 'us-east-1:84008e15-d6af-4698-8646-66d05c1abe8b';

export const IDP_URL = `https://cognito-idp.${REGION}.amazonaws.com/`;
export const IDENTITY_URL = `https://cognito-identity.${REGION}.amazonaws.com/`;

/** An error answered by Cognito: `code` is the exception name (NotAuthorizedException...). */
export class CognitoError extends Error {
  constructor(code, message, status) {
    super(`${code}: ${message}`);
    this.name = 'CognitoError';
    this.code = code;
    this.status = status;
  }
}

async function call(fetchImpl, url, target, body, label) {
  const response = await request(fetchImpl, url, {
    label,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': target,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new WinixUnavailableError(`${label}: unreadable answer (HTTP ${response.status})`);
  }
  if (!response.ok) {
    // "__type" is the bare name, or "com.amazonaws...#Name" depending on the service.
    const code = String(json.__type ?? `HTTP${response.status}`)
      .split('#')
      .pop();
    const message = json.message ?? json.Message ?? '';
    if (response.status >= 500) {
      throw new WinixUnavailableError(`${label}: HTTP ${response.status}`);
    }
    throw new CognitoError(code, message, response.status);
  }
  return json;
}

/** Cognito errors the integration has a sentence for; anything else stays a CognitoError. */
function translate(err, label) {
  if (!(err instanceof CognitoError)) {
    return err;
  }
  switch (err.code) {
    case 'NotAuthorizedException':
    case 'UserNotFoundException':
      // "Password attempts exceeded" is a NotAuthorizedException too: the
      // same remedy, check the password in the Winix app.
      return new WinixAuthError('credentials', `${label}: ${err.code}`, { code: err.code });
    case 'PasswordResetRequiredException':
      return new WinixAuthError('password_reset', `${label}: ${err.code}`, { code: err.code });
    case 'UserNotConfirmedException':
      return new WinixAuthError('not_confirmed', `${label}: ${err.code}`, { code: err.code });
    case 'TooManyRequestsException':
    case 'LimitExceededException':
      return new WinixRateLimitError(`${label}: ${err.code}`, { code: err.code });
    default:
      return new WinixUnavailableError(`${label}: ${err.code}`, { code: err.code });
  }
}

function tokensOf(result, now, previousRefreshToken) {
  if (!result?.AccessToken || !result?.IdToken) {
    throw new WinixUnavailableError('Cognito: no token in the answer');
  }
  return {
    accessToken: result.AccessToken,
    idToken: result.IdToken,
    // A refresh does not send a new refresh token (no rotation on this pool).
    refreshToken: result.RefreshToken ?? previousRefreshToken,
    expiresAt: now() + Number(result.ExpiresIn ?? 3600) * 1000,
  };
}

/**
 * Sign in with the e-mail and password of the Winix account.
 * @returns {Promise<{ accessToken: string, idToken: string, refreshToken: string, expiresAt: number }>}
 * @throws {WinixAuthError} credentials refused
 */
export async function login({ fetch: fetchImpl, username, password, now = Date.now, srp }) {
  const session = srp ?? createSrpSession();
  try {
    const challenge = await call(
      fetchImpl,
      IDP_URL,
      'AWSCognitoIdentityProviderService.InitiateAuth',
      {
        AuthFlow: 'USER_SRP_AUTH',
        ClientId: CLIENT_ID,
        AuthParameters: { USERNAME: username, SRP_A: session.srpA },
      },
      'Cognito sign-in',
    );
    if (challenge.ChallengeName !== 'PASSWORD_VERIFIER') {
      throw new WinixUnavailableError(`Cognito sign-in: unexpected ${challenge.ChallengeName}`);
    }
    const params = challenge.ChallengeParameters ?? {};
    const responses = session.answer({
      poolId: USER_POOL_ID,
      userId: params.USER_ID_FOR_SRP,
      password,
      saltHex: params.SALT,
      srpBHex: params.SRP_B,
      secretBlock: params.SECRET_BLOCK,
      date: new Date(now()),
    });
    const answer = await call(
      fetchImpl,
      IDP_URL,
      'AWSCognitoIdentityProviderService.RespondToAuthChallenge',
      {
        ChallengeName: 'PASSWORD_VERIFIER',
        ClientId: CLIENT_ID,
        ChallengeResponses: responses,
        ...(challenge.Session ? { Session: challenge.Session } : {}),
      },
      'Cognito sign-in',
    );
    if (answer.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
      throw new WinixAuthError('password_reset', 'Cognito sign-in: NEW_PASSWORD_REQUIRED');
    }
    if (answer.ChallengeName) {
      throw new WinixUnavailableError(`Cognito sign-in: unexpected ${answer.ChallengeName}`);
    }
    return tokensOf(answer.AuthenticationResult, now);
  } catch (err) {
    throw translate(err, 'Cognito sign-in');
  }
}

/**
 * New access and id tokens from the refresh token (valid 30 days by default).
 * @throws {WinixRefreshExpiredError} a full sign-in is needed
 */
export async function refresh({ fetch: fetchImpl, refreshToken, now = Date.now }) {
  try {
    const answer = await call(
      fetchImpl,
      IDP_URL,
      'AWSCognitoIdentityProviderService.InitiateAuth',
      {
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        ClientId: CLIENT_ID,
        AuthParameters: { REFRESH_TOKEN: refreshToken },
      },
      'Cognito refresh',
    );
    return tokensOf(answer.AuthenticationResult, now, refreshToken);
  } catch (err) {
    if (err instanceof CognitoError && err.code === 'NotAuthorizedException') {
      throw new WinixRefreshExpiredError('Cognito refresh: NotAuthorizedException', {
        code: err.code,
      });
    }
    throw translate(err, 'Cognito refresh');
  }
}

/**
 * The Cognito identity id of the account (identity pool), stable for the
 * account: the device API wants it in every control URL.
 */
export async function getIdentityId({ fetch: fetchImpl, idToken }) {
  try {
    const answer = await call(
      fetchImpl,
      IDENTITY_URL,
      'AWSCognitoIdentityService.GetId',
      {
        IdentityPoolId: IDENTITY_POOL_ID,
        Logins: { [`cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`]: idToken },
      },
      'Cognito identity',
    );
    if (!answer.IdentityId) {
      throw new WinixUnavailableError('Cognito identity: no IdentityId in the answer');
    }
    return answer.IdentityId;
  } catch (err) {
    if (err instanceof CognitoError && err.code === 'NotAuthorizedException') {
      // The id token expired between two calls: a refresh fixes it.
      throw new WinixRefreshExpiredError('Cognito identity: NotAuthorizedException', {
        code: err.code,
      });
    }
    throw translate(err, 'Cognito identity');
  }
}

/** The `sub` claim of a Cognito token: the user id, without verifying the signature. */
export function tokenSubject(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}
