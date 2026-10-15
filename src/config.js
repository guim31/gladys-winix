// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys, from the `config_schema` of
// `gladys-assistant-integration.json`; the SDK fetches it (`getConfig()`) and
// notifies every change (`onConfigUpdated()`). This module provides the
// defaults and normalizes the received object.
// -----------------------------------------------------------------------------

/** The languages of the Gladys interface, for the texts the container produces. */
export const LANGUAGES = ['en', 'fr', 'de', 'es'];

/** Bounds of the refresh interval, in minutes. */
export const REFRESH_MINUTES_MIN = 1;
export const REFRESH_MINUTES_MAX = 5;

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  username: '',
  password: '',
  // Minutes between two reads of each purifier.
  refresh_interval: 2,
  // Language of the feature names and of the texts the container produces.
  language: 'fr',
};

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const minutes = Math.round(Number(raw.refresh_interval ?? DEFAULT_CONFIG.refresh_interval));
  return {
    username: String(raw.username ?? '').trim(),
    password: String(raw.password ?? ''),
    refresh_interval: Number.isFinite(minutes)
      ? Math.min(REFRESH_MINUTES_MAX, Math.max(REFRESH_MINUTES_MIN, minutes))
      : DEFAULT_CONFIG.refresh_interval,
    language: LANGUAGES.includes(raw.language) ? raw.language : DEFAULT_CONFIG.language,
  };
}

/** Whether the account credentials are filled in. */
export function isConfigured(config) {
  return config.username !== '' && config.password !== '';
}

/** The refresh interval, in milliseconds. */
export function refreshIntervalMs(config) {
  return config.refresh_interval * 60 * 1000;
}
