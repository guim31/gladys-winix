// -----------------------------------------------------------------------------
// One HTTP request to the Winix cloud, with a timeout. The error messages name
// the endpoint, never the URL: the control URL carries the account identity,
// which is as good as a key to the purifiers.
// -----------------------------------------------------------------------------

import { WinixUnavailableError } from './errors.js';

export const REQUEST_TIMEOUT_MS = 15_000;

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} url
 * @param {RequestInit & { label: string }} options `label` names the endpoint in errors
 * @returns {Promise<Response>}
 */
export async function request(fetchImpl, url, { label, ...init }) {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    const reason = err?.name === 'TimeoutError' ? 'timeout' : (err?.cause?.code ?? 'network error');
    throw new WinixUnavailableError(`${label}: ${reason}`);
  }
}
