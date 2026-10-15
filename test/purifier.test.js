// -----------------------------------------------------------------------------
// The purifier model: reading the attribute codes, planning the commands, the
// filter life.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  airQualityLevel,
  applySteps,
  filterLifeHours,
  filterRemaining,
  maxSpeed,
  parseAttributes,
  planCommand,
} from '../src/winix/purifier.js';
import { fixture } from './helpers/fakeWinix.js';

const c545 = fixture('status-c545').body.data[0].attributes;
const pm25 = fixture('status-pm25').body.data[0].attributes;

test('the C545 fixture reads as an idle purifier in auto mode', () => {
  assert.deepEqual(parseAttributes(c545), {
    power: false,
    mode: 'auto',
    speed: 1,
    plasmawave: false,
    filterHoursUsed: 1257,
    airQuality: 0,
    pm25: null,
    ambientLight: 121,
  });
  assert.equal(parseAttributes(pm25).pm25, 12);
});

test('sleep is the sleep airflow of the manual mode; every airflow has its speed', () => {
  assert.equal(parseAttributes({ A03: '02', A04: '06' }).mode, 'sleep');
  assert.equal(parseAttributes({ A03: '02', A04: '06' }).speed, 0);
  assert.equal(parseAttributes({ A03: '02', A04: '03' }).mode, 'manual');
  const speeds = ['01', '02', '03', '05', '08'].map((code) => parseAttributes({ A04: code }).speed);
  assert.deepEqual(speeds, [1, 2, 3, 4, 5]);
  assert.equal(parseAttributes({ A04: '99' }).speed, null);
  assert.equal(parseAttributes({}).mode, null);
});

test('air quality: the 1-4 codes and the decimal form of some firmwares', () => {
  assert.deepEqual(['01', '02', '03', '04'].map(airQualityLevel), [0, 1, 2, 3]);
  assert.deepEqual(['1.0', '1.5', '2.4', '3.6'].map(airQualityLevel), [0, 1, 2, 3]);
  assert.equal(airQualityLevel(undefined), null);
  assert.equal(airQualityLevel('n/a'), null);
});

test('the Tower Prime has a fifth speed (Super Clean)', () => {
  assert.equal(maxSpeed('TOWER PRIME'), 5);
  assert.equal(maxSpeed('C545'), 4);
  assert.equal(maxSpeed(undefined), 4);
});

test('filter life: the cloud table, the built-in one, then 9 months', () => {
  assert.equal(filterLifeHours('T810_EU', { t810_eu: 8640 }), 8640);
  assert.equal(filterLifeHours('C545'), 6480);
  assert.equal(filterLifeHours('XQ'), 8640);
  assert.equal(filterLifeHours('unknown'), 6480);
  assert.deepEqual(filterRemaining(1257, 6480), { hours: 5223, percent: 81 });
  assert.deepEqual(filterRemaining(7000, 6480), { hours: 0, percent: 0 }, 'overdue: 0, not null');
  assert.equal(filterRemaining(null, 6480), null);
});

test('a mode or a speed switches the purifier on first', () => {
  const off = { A02: '0', A03: '01', A04: '01' };
  assert.deepEqual(planCommand(off, { mode: 'sleep' }), [
    ['A02', '1'],
    ['A04', '06'],
  ]);
  assert.deepEqual(planCommand(off, { speed: 3 }), [
    ['A02', '1'],
    ['A03', '02'],
    ['A04', '03'],
  ]);
  const on = { ...off, A02: '1' };
  assert.deepEqual(planCommand(on, { mode: 'auto' }), [['A03', '01']]);
  assert.deepEqual(planCommand(on, { speed: 0 }), [['A04', '06']]);
});

test('manual from sleep leaves the sleep airflow for low', () => {
  const sleeping = { A02: '1', A03: '02', A04: '06' };
  assert.deepEqual(planCommand(sleeping, { mode: 'manual' }), [
    ['A03', '02'],
    ['A04', '01'],
  ]);
  assert.deepEqual(planCommand(sleeping, { speed: 4 }), [['A04', '05']]);
});

test('power and Plasmawave are one write each', () => {
  assert.deepEqual(planCommand({ A02: '1' }, { power: false }), [['A02', '0']]);
  assert.deepEqual(planCommand({ A02: '0' }, { plasmawave: true }), [['A07', '1']]);
});

test('an unknown mode or speed is refused', () => {
  assert.throws(() => planCommand({}, { mode: 'turbo' }), RangeError);
  assert.throws(() => planCommand({}, { speed: 9 }), RangeError);
});

test('the expected state after the writes', () => {
  const after = applySteps({ A02: '0', A03: '01', A04: '01' }, [
    ['A02', '1'],
    ['A04', '05'],
  ]);
  assert.deepEqual(parseAttributes(after).mode, 'manual');
  assert.equal(parseAttributes(after).speed, 4);
  const woken = applySteps({ A02: '1', A03: '02', A04: '06' }, [['A03', '01']]);
  assert.equal(parseAttributes(woken).mode, 'auto');
});
