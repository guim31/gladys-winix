// -----------------------------------------------------------------------------
// Quiet logs (see CLAUDE.md): a normal refresh writes nothing at the info
// level, a failure that repeats is one line when it starts and one when it
// ends, and no secret of the configuration or of the Winix session ever
// reaches the logs — not even at the debug level.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '@gladysassistant/integration-sdk';
import { createWorld, CONFIG } from './helpers/world.js';
import { createFakeWinix, PASSWORD, USERNAME } from './helpers/fakeWinix.js';

async function settle() {
  for (let i = 0; i < 50; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Capture every log line (the SDK logger writes to the console). */
function capture(t) {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'debug';
  t.after(() => {
    if (previous === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = previous;
    }
  });
  const lines = [];
  for (const stream of ['log', 'error', 'warn', 'info', 'debug']) {
    t.mock.method(console, stream, (...args) => lines.push(args.join(' ')));
  }
  return lines;
}

async function running(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const lines = capture(t);
  const winix = createFakeWinix();
  const logger = createLogger({ name: 'winix', level: 'debug' });
  const probe = await createWorld({ winix, logger });
  probe.app.stop();
  const world = await createWorld({
    winix,
    logger,
    store: probe.store,
    devices: probe.gladys.fake.discoveredDevices,
    timers: true,
  });
  t.after(() => world.app.stop());
  return { ...world, lines };
}

const atLevel = (lines, level) => lines.filter((line) => line.includes(`[${level}]`));

test('a normal refresh cycle writes nothing at the info level', async (t) => {
  const { lines, winix } = await running(t);
  lines.length = 0;
  winix.attributes.get('0A1B2C3D4E5F_zq7wk2m4x9').S07 = '02';
  t.mock.timers.tick(2 * 60_000);
  await settle();
  t.mock.timers.tick(2 * 60_000);
  await settle();
  assert.ok(atLevel(lines, 'DEBUG').length > 0, 'the cycle ran (debug lines)');
  assert.deepEqual(atLevel(lines, 'INFO'), []);
  assert.deepEqual(atLevel(lines, 'WARN'), []);
  assert.deepEqual(atLevel(lines, 'ERROR'), []);
});

test('the Winix cloud down for three cycles: one warning, then one line when it is back', async (t) => {
  const { lines, winix } = await running(t);
  lines.length = 0;
  winix.state.down = true;
  for (let i = 0; i < 3; i += 1) {
    t.mock.timers.tick(2 * 60_000);
    await settle();
  }
  const warnings = atLevel(lines, 'WARN');
  assert.equal(warnings.length, 1, warnings.join('\n'));
  assert.match(warnings[0], /Reading the purifiers failed \(Winix status: ECONNREFUSED\)/);

  winix.state.down = false;
  t.mock.timers.tick(2 * 60_000);
  await settle();
  assert.deepEqual(
    atLevel(lines, 'INFO').map((line) => line.replace(/^.*\] /, '')),
    ['Winix cloud answers again'],
  );
});

test('a purifier unplugged then plugged again: one line each way', async (t) => {
  const { lines, winix } = await running(t);
  lines.length = 0;
  winix.state.offline.add('0A1B2C3D4E5F_zq7wk2m4x9');
  for (let i = 0; i < 3; i += 1) {
    t.mock.timers.tick(2 * 60_000);
    await settle();
  }
  winix.state.offline.clear();
  t.mock.timers.tick(2 * 60_000);
  await settle();
  assert.deepEqual(
    atLevel(lines, 'INFO').map((line) => line.replace(/^.*\] /, '')),
    ['Living room is offline', 'Living room is back online'],
  );
});

test('no secret in the logs, even at the debug level', async (t) => {
  const { lines, winix, gladys } = await running(t);
  // Everything that logs: a scan (new session), commands, a widget, a refresh.
  await gladys.fake.scanRequest();
  const living = gladys.fake.discoveredDevices[0];
  for (const key of ['power', 'mode']) {
    const feature = living.features.find((f) => f.external_id.endsWith(`:${key}`));
    await gladys.fake.setValue(living, feature, key === 'mode' ? 'sleep' : 1);
  }
  await gladys.fake.widgetGet('purifier', {
    settings: { device: living.external_id },
    language: 'en',
    units: 'metric',
  });
  t.mock.timers.tick(2 * 60_000);
  await settle();
  await gladys.fake.configUpdated({ ...CONFIG, password: 'a new secret' });

  const all = lines.join('\n');
  assert.ok(lines.length > 10);
  for (const secret of [...winix.secrets(), PASSWORD, 'a new secret', USERNAME]) {
    assert.ok(!all.includes(secret), `a secret leaked into the logs: ${secret.slice(0, 12)}…`);
  }
});

test('a user command is one info line', async (t) => {
  const { lines, gladys } = await running(t);
  lines.length = 0;
  const living = gladys.fake.discoveredDevices[0];
  const feature = living.features.find((f) => f.external_id.endsWith(':fan-speed'));
  await gladys.fake.setValue(living, feature, 3);
  assert.deepEqual(
    atLevel(lines, 'INFO').map((line) => line.replace(/^.*\] /, '')),
    ['Living room: fan-speed = 3'],
  );
});
