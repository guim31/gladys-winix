// -----------------------------------------------------------------------------
// What can go wrong with the Winix cloud, as distinct error classes: the
// integration reacts differently to each (stop signing in, wait, retry later,
// mark a purifier offline). Messages never carry a token or a password.
// -----------------------------------------------------------------------------

/** Base class: `kind` is what the integration switches on. */
export class WinixError extends Error {
  constructor(kind, message, { code } = {}) {
    super(message);
    this.name = 'WinixError';
    this.kind = kind;
    this.code = code;
  }
}

/**
 * Cognito refused the e-mail and password (or the account needs a step in the
 * Winix app: confirmation, password reset). Signing in again with the same
 * credentials would fail the same way and may lock the account: the
 * integration waits for new credentials.
 * `reason`: 'credentials' | 'password_reset' | 'not_confirmed'.
 */
export class WinixAuthError extends WinixError {
  constructor(reason, message, options) {
    super('auth', message, options);
    this.name = 'WinixAuthError';
    this.reason = reason;
  }
}

/** The refresh token expired or was revoked: a full sign-in is needed. */
export class WinixRefreshExpiredError extends WinixError {
  constructor(message = 'Refresh token expired', options) {
    super('refresh_expired', message, options);
    this.name = 'WinixRefreshExpiredError';
  }
}

/**
 * The Winix mobile session is no longer valid (result code 400 or 900 "MULTI
 * LOGIN": the same account signed in elsewhere). A new session is needed to
 * list the purifiers; reading and controlling them does not need one.
 */
export class WinixSessionError extends WinixError {
  constructor(message, options) {
    super('session', message, options);
    this.name = 'WinixSessionError';
  }
}

/** HTTP 403 or 429 from the device API, or a Cognito throttle: wait before retrying. */
export class WinixRateLimitError extends WinixError {
  constructor(message = 'Rate limited by the Winix cloud', options) {
    super('rate_limit', message, options);
    this.name = 'WinixRateLimitError';
  }
}

/** The cloud has no data for the purifier: unplugged, out of Wi-Fi, or unknown. */
export class WinixOfflineError extends WinixError {
  constructor(message = 'The purifier does not answer', options) {
    super('offline', message, options);
    this.name = 'WinixOfflineError';
  }
}

/** Network error, timeout, 5xx or an answer that cannot be read. */
export class WinixUnavailableError extends WinixError {
  constructor(message, options) {
    super('unavailable', message, options);
    this.name = 'WinixUnavailableError';
  }
}
