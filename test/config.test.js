import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, isConfigured, normalizeConfig, refreshIntervalMs } from '../src/config.js';

test('normalizeConfig fills in the defaults', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  assert.equal(isConfigured(normalizeConfig()), false);
});

test('the e-mail is trimmed, the password kept as typed', () => {
  const config = normalizeConfig({ username: ' jane@example.com ', password: ' pass ' });
  assert.equal(config.username, 'jane@example.com');
  assert.equal(config.password, ' pass ');
  assert.equal(isConfigured(config), true);
});

test('the refresh interval stays between 1 and 5 minutes', () => {
  assert.equal(normalizeConfig({ refresh_interval: '3' }).refresh_interval, 3);
  assert.equal(normalizeConfig({ refresh_interval: 0 }).refresh_interval, 1);
  assert.equal(normalizeConfig({ refresh_interval: 60 }).refresh_interval, 5);
  assert.equal(normalizeConfig({ refresh_interval: 2.6 }).refresh_interval, 3);
  assert.equal(normalizeConfig({ refresh_interval: 'soon' }).refresh_interval, 2);
  assert.equal(refreshIntervalMs(normalizeConfig({ refresh_interval: 5 })), 300_000);
});

test('an unknown language falls back to French', () => {
  assert.equal(normalizeConfig({ language: 'de' }).language, 'de');
  assert.equal(normalizeConfig({ language: 'it' }).language, 'fr');
});

test('nothing but the declared keys: no stray value from the form', () => {
  assert.deepEqual(Object.keys(normalizeConfig({ intro: 'x', other: 1 })).sort(), [
    'language',
    'password',
    'refresh_interval',
    'username',
  ]);
});
