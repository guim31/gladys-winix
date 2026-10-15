// -----------------------------------------------------------------------------
// The integration end to end, against the SDK's fake Gladys and the fake
// Winix cloud: discovery, states, commands, offline purifiers, the status of
// the Configuration screen.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, CONFIG } from './helpers/world.js';
import { createFakeWinix, PASSWORD, USERNAME } from './helpers/fakeWinix.js';
import { createMemoryStore } from '../src/store.js';
import { STATUS, TEXT } from '../src/i18n.js';

const LIVING = 'ext:test-integration:purifier:0a1b2c3d4e5f';
const BEDROOM = 'ext:test-integration:purifier:0a1b2c3d4e60';
const DEVICE_API = 'us.api.winix-iot.com';

function feature(device, key) {
  return device.features.find((f) => f.external_id === `${device.external_id}:${key}`);
}

test('the purifiers of the account are offered in the Discovery tab, with French names', async (t) => {
  const { gladys, app } = await createWorld();
  t.after(() => app.stop());
  const devices = gladys.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((d) => [d.name, d.external_id, d.model]),
    [
      ['Living room', LIVING, 'C545'],
      ['Bedroom', BEDROOM, 'T810'],
    ],
  );
  const bedroom = devices[1];
  assert.deepEqual(
    bedroom.features.map((f) => [f.external_id.split(':').pop(), f.name]),
    [
      ['power', 'Marche'],
      ['mode', 'Mode'],
      ['fan-speed', 'Vitesse du ventilateur'],
      ['plasmawave', 'Plasmawave'],
      ['air-quality', "Pollution de l'air"],
      ['pm25', 'PM2.5'],
      ['ambient-light', 'Luminosité ambiante'],
      ['filter-life', 'Durée de vie du filtre'],
      ['filter-hours', 'Heures de filtre restantes'],
      ['online', 'En ligne'],
    ],
  );
  assert.equal(feature(devices[0], 'pm25'), undefined, 'the C545 has no PM2.5 sensor');
  assert.deepEqual(
    feature(bedroom, 'mode').supported_options.map((o) => [o.value, o.label]),
    [
      ['auto', 'Auto'],
      ['manual', 'Manuel'],
      ['sleep', 'Sommeil'],
    ],
  );
  assert.equal(feature(bedroom, 'filter-hours').max, 8640, 'the filter life the cloud gave');
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
});

test('a purifier added to Gladys gets all its states at once', async (t) => {
  const { gladys, app, addAll } = await createWorld();
  t.after(() => app.stop());
  await addAll();
  const state = (key) => gladys.fake.lastState(`${BEDROOM}:${key}`);
  assert.equal(state('online'), 1);
  assert.equal(state('power'), 0);
  assert.equal(state('mode'), 'auto');
  assert.equal(state('fan-speed'), 1);
  assert.equal(state('plasmawave'), 0);
  assert.equal(state('air-quality'), 0);
  assert.equal(state('pm25'), 12);
  assert.equal(state('ambient-light'), 121);
  assert.equal(state('filter-life'), 85);
  assert.equal(state('filter-hours'), 7383);
  assert.ok(gladys.fake.widgetRefreshes.includes('purifier'), 'the widget is told');
});

test('commands from the dashboard reach the purifier, and the states follow at once', async (t) => {
  const { gladys, app, addAll, winix } = await createWorld();
  t.after(() => app.stop());
  await addAll();
  const living = gladys.fake.discoveredDevices[0];
  const run = (key, value) => gladys.fake.setValue(living, feature(living, key), value);

  assert.deepEqual(await run('power', 1), { success: true });
  assert.deepEqual(winix.state.controls.at(-1), {
    deviceId: '0A1B2C3D4E5F_zq7wk2m4x9',
    attribute: 'A02',
    value: '1',
  });
  assert.equal(gladys.fake.lastState(`${LIVING}:power`), 1);

  assert.deepEqual(await run('mode', 'sleep'), { success: true });
  assert.equal(gladys.fake.lastState(`${LIVING}:mode`), 'sleep');
  assert.equal(gladys.fake.lastState(`${LIVING}:fan-speed`), 0);

  assert.deepEqual(await run('fan-speed', 4), { success: true });
  assert.deepEqual(winix.state.controls.at(-1).value, '05');
  assert.equal(gladys.fake.lastState(`${LIVING}:mode`), 'manual');

  assert.deepEqual(await run('plasmawave', 1), { success: true });
  assert.equal(gladys.fake.lastState(`${LIVING}:plasmawave`), 1);

  assert.deepEqual(await run('mode', 'auto'), { success: true });
  assert.equal(winix.attributes.get('0A1B2C3D4E5F_zq7wk2m4x9').A03, '01');

  // Sensors are not commands.
  const refused = await run('pm25', 3);
  assert.equal(refused.success, false);
});

test('a purifier that goes offline: its online state drops, commands say why', async (t) => {
  const { gladys, app, addAll, winix } = await createWorld();
  t.after(() => app.stop());
  await addAll();
  winix.state.offline.add('0A1B2C3D4E5F_zq7wk2m4x9');
  const living = gladys.fake.discoveredDevices[0];
  await gladys.fake.poll(living);
  // A poll right after the add is skipped (read less than 90 % of an interval ago).
  assert.equal(gladys.fake.lastState(`${LIVING}:online`), 1);
  await app.stop();
  await gladys.fake.configUpdated({ ...CONFIG, refresh_interval: 1 });
  assert.equal(gladys.fake.lastState(`${LIVING}:online`), 0);
  assert.equal(gladys.fake.lastState(`${LIVING}:power`), 0, 'the last known values stay');
  const answer = await gladys.fake.setValue(living, feature(living, 'power'), 1);
  assert.deepEqual(answer, { success: false, error: TEXT.offline.fr });

  winix.state.offline.clear();
  await gladys.fake.configUpdated({ ...CONFIG, refresh_interval: 2 });
  assert.equal(gladys.fake.lastState(`${LIVING}:online`), 1);
});

test('not configured: a clear status, no request to Winix', async (t) => {
  const winix = createFakeWinix();
  const { gladys, app } = await createWorld({ config: {}, winix });
  t.after(() => app.stop());
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: false,
    message: STATUS.notConfigured,
  });
  assert.equal(winix.state.calls.length, 0);
  assert.deepEqual(gladys.fake.discoveredDevices, []);
});

test('a refused password: a clear status, and no new sign-in at each refresh', async (t) => {
  const winix = createFakeWinix();
  const { gladys, app } = await createWorld({
    config: { username: USERNAME, password: 'wrong' },
    winix,
  });
  t.after(() => app.stop());
  assert.deepEqual(gladys.fake.connectionStatus, { connected: false, message: STATUS.credentials });
  const attempts = winix.count('cognito-idp.us-east-1.amazonaws.com');
  await gladys.fake.scanRequest();
  await gladys.fake.configUpdated({ username: USERNAME, password: 'wrong', refresh_interval: 3 });
  assert.equal(winix.count('cognito-idp.us-east-1.amazonaws.com'), attempts);

  // The user fixes the password.
  await gladys.fake.configUpdated(CONFIG);
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
  assert.equal(gladys.fake.discoveredDevices.length, 2);
});

test('Winix unreachable at start: a status, then the refresh cycle connects', async (t) => {
  const winix = createFakeWinix();
  winix.state.down = true;
  const { gladys, app } = await createWorld({ winix });
  t.after(() => app.stop());
  assert.deepEqual(gladys.fake.connectionStatus, { connected: false, message: STATUS.unreachable });
  winix.state.down = false;
  await gladys.fake.configUpdated(CONFIG);
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
  assert.equal(gladys.fake.discoveredDevices.length, 2);
});

test('a restart uses /data: the purifiers are read without signing in again', async (t) => {
  const winix = createFakeWinix();
  const store = createMemoryStore();
  const first = await createWorld({ winix, store });
  first.app.stop();
  assert.equal(winix.state.signIns, 1);

  const devices = first.gladys.fake.discoveredDevices;
  const second = await createWorld({ winix, store, devices });
  t.after(() => second.app.stop());
  assert.equal(winix.state.signIns, 1, 'no second sign-in');
  assert.equal(winix.count('us.mobile.winix-iot.com', '/registerUser'), 1, 'no second session');
  assert.equal(second.gladys.fake.lastState(`${LIVING}:online`), 1, 'read at start');
  assert.deepEqual(second.gladys.fake.connectionStatus, { connected: true });
});

test('a scan lists the account again, even when the phone took the session', async (t) => {
  const { gladys, app, winix } = await createWorld();
  t.after(() => app.stop());
  winix.phoneSignsIn();
  await gladys.fake.scanRequest();
  assert.equal(gladys.fake.discoveredDevices.length, 2);
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
});

test('reading a purifier does not need the mobile session (the phone app keeps it)', async (t) => {
  const { gladys, app, addAll, winix } = await createWorld();
  t.after(() => app.stop());
  await addAll();
  winix.phoneSignsIn();
  const before = winix.count('us.mobile.winix-iot.com');
  await gladys.fake.configUpdated({ ...CONFIG, refresh_interval: 3 });
  const living = gladys.fake.discoveredDevices[0];
  assert.deepEqual(await gladys.fake.setValue(living, feature(living, 'power'), 1), {
    success: true,
  });
  assert.equal(winix.count('us.mobile.winix-iot.com'), before, 'no mobile request');
  assert.ok(winix.count(DEVICE_API) > 0);
});

test('the feature names follow the language of the configuration', async (t) => {
  for (const [language, power, mode] of [
    ['en', 'Power', 'Sleep'],
    ['de', 'Betrieb', 'Schlaf'],
    ['es', 'Encendido', 'Sueño'],
  ]) {
    const { gladys, app } = await createWorld({ config: { ...CONFIG, language } });
    t.after(() => app.stop());
    const [device] = gladys.fake.discoveredDevices;
    assert.equal(feature(device, 'power').name, power);
    assert.equal(feature(device, 'mode').supported_options[2].label, mode);
  }
});

test('the password and the identity never reach Gladys', async (t) => {
  const { gladys, app, addAll, winix } = await createWorld();
  t.after(() => app.stop());
  await addAll();
  const published = JSON.stringify(gladys.fake.requests);
  for (const secret of winix.secrets()) {
    assert.ok(!published.includes(secret));
  }
  assert.ok(!published.includes(PASSWORD));
});
