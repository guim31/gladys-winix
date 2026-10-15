// -----------------------------------------------------------------------------
// The container refreshes the purifiers by itself (GladysAssistant/Gladys#3198:
// the core may never call onPoll), at the configured interval; the core's
// onPoll is a fallback that never doubles a read.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, CONFIG } from './helpers/world.js';
import { createFakeWinix } from './helpers/fakeWinix.js';

const LIVING = 'ext:test-integration:purifier:0a1b2c3d4e5f';
const LIVING_ID = '0A1B2C3D4E5F_zq7wk2m4x9';
const STATUS_PATH = `/common/event/sttus/devices/${LIVING_ID}`;

/** Let the reads started by a fired timer run to their end. */
async function settle() {
  for (let i = 0; i < 50; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function setup(t, config = CONFIG) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const winix = createFakeWinix();
  // The user already added both purifiers: Gladys knows them at connection.
  const probe = await createWorld({ winix, connect: true });
  probe.app.stop();
  const devices = probe.gladys.fake.discoveredDevices;
  const world = await createWorld({ winix, config, devices, timers: true, store: probe.store });
  t.after(() => world.app.stop());
  const reads = () => winix.count('us.api.winix-iot.com', STATUS_PATH);
  return { ...world, reads, devices };
}

test('the states refresh every interval without any onPoll from the core (Gladys#3198)', async (t) => {
  const { gladys, winix, reads } = await setup(t);
  const start = reads();
  assert.equal(gladys.fake.lastState(`${LIVING}:power`), 0);

  winix.attributes.get(LIVING_ID).A02 = '1';
  t.mock.timers.tick(2 * 60_000);
  await settle();
  assert.equal(reads(), start + 1, 'read again after one interval');
  assert.equal(gladys.fake.lastState(`${LIVING}:power`), 1, 'the change reached Gladys');

  t.mock.timers.tick(2 * 60_000);
  await settle();
  assert.equal(reads(), start + 2);
});

test('the interval of the configuration is honored (5 minutes)', async (t) => {
  const { reads } = await setup(t, { ...CONFIG, refresh_interval: 5 });
  const start = reads();
  t.mock.timers.tick(4 * 60_000);
  await settle();
  assert.equal(reads(), start, 'not before 5 minutes');
  t.mock.timers.tick(60_000);
  await settle();
  assert.equal(reads(), start + 1);
});

test("the core's onPoll is a fallback: no second read within an interval", async (t) => {
  const { gladys, reads, devices, app } = await setup(t);
  const start = reads();
  const living = devices[0];

  // The core polls every minute (the poll frequency of the device).
  t.mock.timers.tick(60_000);
  assert.deepEqual(await gladys.fake.poll(living), { success: true });
  assert.equal(reads(), start, 'the timer read it a minute ago');

  t.mock.timers.tick(60_000);
  await settle();
  assert.equal(reads(), start + 1, 'the timer');
  assert.deepEqual(await gladys.fake.poll(living), { success: true });
  assert.equal(reads(), start + 1);

  // The timer stalls: the core takes over, once an interval.
  app.stop();
  t.mock.timers.tick(60_000);
  await gladys.fake.poll(living);
  assert.equal(reads(), start + 1);
  t.mock.timers.tick(60_000);
  await gladys.fake.poll(living);
  assert.equal(reads(), start + 2);
});

test('only what changed is published, and a stable value again after 6 hours', async (t) => {
  const { gladys, winix } = await setup(t);
  const count = () => gladys.fake.states.length;
  const first = count();

  t.mock.timers.tick(2 * 60_000);
  await settle();
  assert.equal(count(), first, 'nothing changed, nothing sent');

  winix.attributes.get(LIVING_ID).S07 = '03';
  t.mock.timers.tick(2 * 60_000);
  await settle();
  assert.deepEqual(
    gladys.fake.states.slice(first).map((s) => [s.device_feature_external_id, s.state]),
    [[`${LIVING}:air-quality`, 2]],
  );

  // The heartbeat: every value again once it is 6 hours old.
  const before = count();
  t.mock.timers.tick(6 * 60 * 60_000);
  await settle();
  assert.ok(count() - before >= 18, 'the stable values of both purifiers again');
});

test('a command is confirmed by a read a few seconds later', async (t) => {
  const { gladys, winix, reads, devices } = await setup(t);
  const living = devices[0];
  const start = reads();
  const power = living.features.find((f) => f.external_id.endsWith(':power'));
  await gladys.fake.setValue(living, power, 1);
  // The purifier did not follow (unplugged at that moment, say).
  winix.attributes.get(LIVING_ID).A02 = '0';
  t.mock.timers.tick(5000);
  await settle();
  assert.equal(reads(), start + 1);
  assert.equal(gladys.fake.lastState(`${LIVING}:power`), 0, 'Gladys shows what it really did');
});
