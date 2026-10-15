// -----------------------------------------------------------------------------
// The client side of the Secure Remote Password exchange of AWS Cognito
// (USER_SRP_AUTH), the only sign-in flow the Winix app client accepts.
//
// The password never leaves the container: Cognito sends a salt and its public
// value B, the client proves it knows the password with an HMAC signature.
// Written from the algorithm of the AWS Amplify `AuthenticationHelper`
// (Apache-2.0), with node:crypto and BigInt only — no AWS SDK, which weighs
// megabytes the 256 MB sandbox does not need.
// -----------------------------------------------------------------------------

import { createHash, createHmac, randomBytes as nodeRandomBytes } from 'node:crypto';

// The 3072-bit group of RFC 5054 used by Cognito, and its generator.
const N_HEX =
  'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DD' +
  'EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' +
  'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F' +
  '83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B' +
  'E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA0510' +
  '15728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7' +
  'ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6BF12FFA06D98A0864D87602733EC86A64521F2B18177B200C' +
  'BBE117577A615D6C770988C0BAD946E208E24FA074E5AB3143DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF';

export const N = BigInt(`0x${N_HEX}`);
export const G = 2n;

const INFO = Buffer.from('Caldera Derived Key', 'utf8');

/** SHA-256 of a buffer or string, as 64 hex characters. */
export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

/** SHA-256 of the bytes a hex string encodes. */
export function hexHash(hex) {
  return sha256Hex(Buffer.from(hex, 'hex'));
}

/**
 * Hex of a positive big integer, as Cognito hashes it: an even number of
 * digits, and a leading 00 byte when the first one would read as negative.
 */
export function padHex(value) {
  let hex = typeof value === 'bigint' ? value.toString(16) : value;
  if (hex.length % 2 === 1) {
    hex = `0${hex}`;
  } else if ('89abcdefABCDEF'.includes(hex[0])) {
    hex = `00${hex}`;
  }
  return hex;
}

/** base^exponent mod modulus, for big integers (the result is never negative). */
export function modPow(base, exponent, modulus) {
  let result = 1n;
  let b = ((base % modulus) + modulus) % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) {
      result = (result * b) % modulus;
    }
    e >>= 1n;
    b = (b * b) % modulus;
  }
  return result;
}

/** The SRP-6a multiplier k = H(N | g). */
export const K = BigInt(`0x${hexHash(`${padHex(N)}${padHex(G)}`)}`);

/** u = H(A | B), the scrambling parameter both sides compute. */
export function scrambler(A, B) {
  return BigInt(`0x${hexHash(padHex(A) + padHex(B))}`);
}

/**
 * x = H(salt | H(pool name | user id | ":" | password)), the private value
 * derived from the password.
 */
export function passwordExponent({ poolName, userId, password, saltHex }) {
  const inner = sha256Hex(`${poolName}${userId}:${password}`);
  return BigInt(`0x${hexHash(padHex(BigInt(`0x${saltHex}`)) + inner)}`);
}

/** The 16-byte key HKDF derives from the shared secret S, salted with u. */
export function derivedKey(S, u) {
  const prk = createHmac('sha256', Buffer.from(padHex(u), 'hex'))
    .update(Buffer.from(padHex(S), 'hex'))
    .digest();
  return createHmac('sha256', prk)
    .update(Buffer.concat([INFO, Buffer.from([1])]))
    .digest()
    .subarray(0, 16);
}

/** "Tue Oct 15 09:05:03 UTC 2026": the timestamp format Cognito signs (day not padded). */
export function cognitoTimestamp(date = new Date()) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const two = (n) => String(n).padStart(2, '0');
  return (
    `${days[date.getUTCDay()]} ${months[date.getUTCMonth()]} ${date.getUTCDate()} ` +
    `${two(date.getUTCHours())}:${two(date.getUTCMinutes())}:${two(date.getUTCSeconds())} ` +
    `UTC ${date.getUTCFullYear()}`
  );
}

/** HMAC-SHA256 signature of the password claim, base64. */
export function claimSignature({ key, poolName, userId, secretBlock, timestamp }) {
  return createHmac('sha256', key)
    .update(
      Buffer.concat([
        Buffer.from(poolName, 'utf8'),
        Buffer.from(userId, 'utf8'),
        Buffer.from(secretBlock, 'base64'),
        Buffer.from(timestamp, 'utf8'),
      ]),
    )
    .digest('base64');
}

/**
 * One sign-in attempt: a fresh random a and its public value A, then the
 * answer to the PASSWORD_VERIFIER challenge.
 * @param {object} [options]
 * @param {(size: number) => Buffer} [options.randomBytes] injectable for tests
 */
export function createSrpSession({ randomBytes = nodeRandomBytes } = {}) {
  let a;
  let A;
  do {
    a = BigInt(`0x${randomBytes(128).toString('hex')}`) % N;
    A = modPow(G, a, N);
  } while (a === 0n || A === 0n);

  return {
    /** SRP_A of the InitiateAuth request. */
    srpA: A.toString(16),

    /**
     * The ChallengeResponses of RespondToAuthChallenge.
     * @param {object} challenge
     * @param {string} challenge.poolId e.g. us-east-1_Ofd50EosD
     * @param {string} challenge.userId USER_ID_FOR_SRP
     * @param {string} challenge.password
     * @param {string} challenge.saltHex SALT
     * @param {string} challenge.srpBHex SRP_B
     * @param {string} challenge.secretBlock SECRET_BLOCK (base64)
     * @param {Date} [challenge.date]
     */
    answer({ poolId, userId, password, saltHex, srpBHex, secretBlock, date = new Date() }) {
      const B = BigInt(`0x${srpBHex}`);
      if (B % N === 0n) {
        throw new Error('Invalid SRP_B from Cognito');
      }
      const u = scrambler(A, B);
      if (u === 0n) {
        throw new Error('Invalid SRP scrambler');
      }
      const poolName = poolId.split('_')[1];
      const x = passwordExponent({ poolName, userId, password, saltHex });
      const base = (((B - K * modPow(G, x, N)) % N) + N) % N;
      const S = modPow(base, a + u * x, N);
      const key = derivedKey(S, u);
      const timestamp = cognitoTimestamp(date);
      return {
        TIMESTAMP: timestamp,
        USERNAME: userId,
        PASSWORD_CLAIM_SECRET_BLOCK: secretBlock,
        PASSWORD_CLAIM_SIGNATURE: claimSignature({
          key,
          poolName,
          userId,
          secretBlock,
          timestamp,
        }),
      };
    },
  };
}
