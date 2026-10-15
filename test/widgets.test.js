// -----------------------------------------------------------------------------
// The purifier widget: a content the core renders as sent (budget, texts),
// tiles bound to features the device really has, buttons that drive the
// purifier, the current mode marked by its icon.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createWorld } from './helpers/world.js';
import { buildWidgetContent } from '../src/app.js';
import { TEXT } from '../src/i18n.js';

const LIVING_ID = '0A1B2C3D4E5F_zq7wk2m4x9';

async function widget(world, device, language = 'fr') {
  const answer = await world.gladys.fake.widgetGet('purifier', {
    settings: { device: device?.external_id },
    language,
    units: 'metric',
  });
  assert.equal(answer.success, true, answer.error);
  return answer.data.content;
}

function featureIds(device) {
  return new Set(device.features.map((f) => f.external_id));
}

test('the content fits the core budget, in every language, and binds existing features', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await world.addAll();
  for (const device of world.gladys.fake.discoveredDevices) {
    for (const language of ['en', 'fr', 'de', 'es']) {
      const content = await widget(world, device, language);
      assert.deepEqual(validateWidgetContent(content), [], JSON.stringify(content));
      for (const component of content.components) {
        if (component.device_feature) {
          assert.ok(featureIds(device).has(component.device_feature), component.device_feature);
        }
      }
    }
  }
  const bedroom = await widget(world, world.discovered('Bedroom'));
  assert.deepEqual(
    bedroom.components.map((c) => c.type),
    ['text', 'value', 'gauge', 'status', 'button'],
  );
  assert.deepEqual(
    bedroom.components.find((c) => c.type === 'status').items.map((i) => [i.label, i.value]),
    [
      ['État', 'Éteint'],
      ['Air', 'Bonne'],
      ['Filtre', '85 % · 7383 h'],
    ],
  );

  // Running, with every tile and button: the eight components the core allows.
  const device = world.discovered('Bedroom');
  await world.gladys.fake.widgetAction(
    'purifier',
    'power_on',
    {},
    {
      settings: { device: device.external_id },
    },
  );
  const running = await widget(world, device);
  assert.equal(running.components.length, 8);
  assert.deepEqual(validateWidgetContent(running), []);
});

test('an idle purifier offers to turn it on; a running one, its modes and Off', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await world.addAll();
  const living = world.discovered('Living');
  const buttons = (content) =>
    content.components.filter((c) => c.type === 'button').map((c) => [c.action.key, c.icon]);

  // The fixture purifier is off: one button.
  assert.deepEqual(buttons(await widget(world, living)), [['power_on', 'power']]);

  const on = await world.gladys.fake.widgetAction(
    'purifier',
    'power_on',
    {},
    {
      settings: { device: living.external_id },
    },
  );
  assert.deepEqual(on, { success: true, data: { message: TEXT.done } });
  assert.deepEqual(buttons(await widget(world, living)), [
    ['mode_auto', 'check-circle'],
    ['mode_manual', 'sliders'],
    ['mode_sleep', 'moon'],
    ['power_off', 'power'],
  ]);

  await world.gladys.fake.widgetAction(
    'purifier',
    'mode_sleep',
    {},
    {
      settings: { device: living.external_id },
    },
  );
  assert.equal(world.winix.attributes.get(LIVING_ID).A04, '06');
  const content = await widget(world, living);
  assert.deepEqual(
    buttons(content).find(([key]) => key === 'mode_sleep'),
    ['mode_sleep', 'check-circle'],
  );
  assert.equal(content.components.find((c) => c.type === 'status').items[0].value, 'Sommeil');
});

test('an unknown action, an offline purifier, no purifier chosen', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await world.addAll();
  const living = world.discovered('Living');

  const unknown = await world.gladys.fake.widgetAction(
    'purifier',
    'self_destruct',
    {},
    {
      settings: { device: living.external_id },
    },
  );
  assert.equal(unknown.success, false);

  const none = await widget(world, undefined, 'de');
  assert.deepEqual(none.components, [
    { type: 'text', variant: 'caption', text: TEXT.pickPurifier.de },
  ]);

  world.winix.state.offline.add(LIVING_ID);
  await world.gladys.fake.configUpdated({
    ...world.app.config,
    password: world.app.config.password,
  });
  const offline = await widget(world, living, 'en');
  assert.deepEqual(validateWidgetContent(offline), []);
  assert.deepEqual(offline.components.at(-1).items, [
    { label: 'State', value: 'Offline', color: 'danger' },
  ]);
  const press = await world.gladys.fake.widgetAction(
    'purifier',
    'power_on',
    {},
    {
      settings: { device: living.external_id },
    },
  );
  assert.equal(press.success, false);
});

test('a purifier never read yet says so instead of empty rows', () => {
  const content = buildWidgetContent({
    lang: 'es',
    ids: { feature: (key) => `x:${key}` },
    features: new Set(['power', 'mode']),
    attributes: null,
    online: undefined,
    lifeHours: 6480,
    name: 'Salón',
  });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components.at(-1).text, TEXT.noValueYet.es);
});
