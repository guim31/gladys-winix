// -----------------------------------------------------------------------------
// The Winix integration: wires the Gladys client to the Winix account, the
// purifiers and the dashboard widget.
//
// Everything that talks to the outside is injected (Gladys client, fetch,
// /data store, clock), so the tests run the whole integration against the
// SDK's fake Gladys and a fake Winix cloud.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS, createLogger } from '@gladysassistant/integration-sdk';
import { LANGUAGES, isConfigured, normalizeConfig } from './config.js';
import {
  AIR_QUALITY_LABELS,
  MODE_LABELS,
  STATUS,
  TEXT,
  filterSummary,
  languageOf,
} from './i18n.js';
import {
  DEVICE_TYPE,
  FEATURE,
  buildDevice,
  deviceName,
  featureKeyOf,
  idsOf,
  offlineStates,
  statesFromAttributes,
} from './devices.js';
import { createPoller } from './poller.js';
import { createIssueLog } from './issues.js';
import { createStore } from './store.js';
import { createAccount } from './winix/account.js';
import { createDeviceApi } from './winix/device-api.js';
import { WinixAuthError, WinixOfflineError, WinixRateLimitError } from './winix/errors.js';
import {
  applySteps,
  filterLifeHours,
  filterRemaining,
  parseAttributes,
  planCommand,
} from './winix/purifier.js';

/** The dashboard widget key: forever, like every published key. */
export const WIDGET_KEY = 'purifier';

/** A value that does not change is published again at least this often (12 h max, see CLAUDE.md). */
export const HEARTBEAT_MS = 6 * 60 * 60 * 1000;

/** Delay before reading a purifier again after a command, to show what it really did. */
export const CONFIRM_DELAY_MS = 5000;

/**
 * @param {object} options
 * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
 * @param {typeof fetch} [options.fetch]
 * @param {object} [options.store] /data persistence (src/store.js)
 * @param {object} [options.logger]
 * @param {boolean} [options.timers] periodic refresh and confirmation reads (tests turn them off)
 * @param {() => number} [options.now]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {() => object} [options.srp] SRP session factory (tests)
 */
export function createApp({
  gladys,
  fetch: fetchImpl = globalThis.fetch,
  store = createStore(),
  logger = createLogger({ name: 'winix' }),
  timers = true,
  now = Date.now,
  sleep,
  srp,
}) {
  let config = normalizeConfig();
  const account = createAccount({ fetch: fetchImpl, store, logger, now, srp });
  const api = createDeviceApi({ fetch: fetchImpl, now, sleep });
  const issues = createIssueLog(logger);

  /** Raw attributes last read, by Winix device id. */
  const attributesCache = new Map();
  /** Whether each purifier answered last time, by Winix device id (for the transitions). */
  const online = new Map();
  /** The Winix device of each published Gladys device, by external id. */
  let byExternalId = new Map();
  /** The connection status last sent, to send it only when it changes. */
  let lastStatus = null;
  const confirmTimers = new Set();

  const poller = createPoller({
    gladys,
    getConfig: () => config,
    owns: (device) => byExternalId.has(device.external_id),
    read: (device) => readPurifier(device),
    beforeCycle: () => retrySetup(),
    timers,
    now,
  });

  // --- Connection status -----------------------------------------------------

  async function reportStatus(key) {
    if (key === lastStatus) {
      return;
    }
    lastStatus = key;
    await gladys
      .setConnectionStatus(key === 'ok', key === 'ok' ? undefined : STATUS[key])
      .catch((err) => logger.debug(`Connection status not sent (${err.message})`));
  }

  function statusKeyOf(err) {
    if (err instanceof WinixAuthError) {
      return (
        { password_reset: 'passwordReset', not_confirmed: 'notConfirmed' }[err.reason] ??
        'credentials'
      );
    }
    return err instanceof WinixRateLimitError ? 'rateLimited' : 'unreachable';
  }

  // --- Account and devices ---------------------------------------------------

  /**
   * List the purifiers of the account (a session, maybe a sign-in). Without
   * `force`, the list kept in /data is enough.
   * @returns {Promise<boolean>} whether the account answered
   */
  async function setup({ force = false } = {}) {
    if (!force && account.hasDevices) {
      return true;
    }
    try {
      const devices = await account.syncDevices();
      issues.ok('account', 'Winix account reachable again');
      const ignored =
        account.ignoredCount > 0 ? `, ${account.ignoredCount} other device(s) ignored` : '';
      logger.info(`Winix account connected: ${devices.length} air purifier(s)${ignored}`);
      return true;
    } catch (err) {
      if (err instanceof WinixAuthError) {
        logger.error(`Winix sign-in refused (${err.reason}): waiting for new credentials`);
      } else {
        issues.fail('account', `Winix account unreachable (${err.message})`);
      }
      await reportStatus(statusKeyOf(err));
      return false;
    }
  }

  /** Called before each refresh cycle: an account never listed is tried again. */
  async function retrySetup() {
    if (!isConfigured(config) || account.hasDevices || account.authError) {
      return;
    }
    if (await setup()) {
      await publishDevices();
      await reportStatus('ok');
    }
  }

  function buildDevices() {
    const devices = account.devices.map((device) =>
      buildDevice(gladys, device, {
        language: config.language,
        attributeKeys: account.attributeKeys(device.deviceId),
        filterLife: account.filterLife,
      }),
    );
    byExternalId = new Map(account.devices.map((device) => [idsOf(gladys, device).device, device]));
    return devices;
  }

  /**
   * Read once the purifiers never read: the attributes they report decide
   * their features (PM2.5, ambient light), which are fixed when the user adds
   * them. One request each, one after the other; a failure leaves the
   * common set.
   */
  async function learnAttributes() {
    for (const device of account.devices) {
      if (account.attributeKeys(device.deviceId) !== null) {
        continue;
      }
      try {
        const attributes = await api.getAttributes(device.deviceId);
        attributesCache.set(device.deviceId, attributes);
        online.set(device.deviceId, true);
        await account.rememberAttributeKeys(device.deviceId, Object.keys(attributes));
      } catch (err) {
        logger.debug(`${deviceName(device)}: not read before publication (${err.message})`);
      }
    }
  }

  async function publishDevices() {
    await learnAttributes();
    try {
      await gladys.publishDiscoveredDevices(buildDevices());
    } catch (err) {
      logger.error(`Publishing the purifiers failed: ${err.message}`);
    }
  }

  /**
   * The feature keys of a purifier in Gladys: those of the device the user
   * added, or those it would be published with.
   */
  function featuresOf(externalId, device) {
    const created = (gladys.devices ?? []).find((d) => d.external_id === externalId);
    const features =
      created?.features ??
      buildDevice(gladys, device, {
        language: config.language,
        attributeKeys: account.attributeKeys(device.deviceId),
        filterLife: account.filterLife,
      }).features;
    return new Set(features.map((feature) => featureKeyOf(feature.external_id)));
  }

  function lifeHoursOf(device) {
    return filterLifeHours(device.modelId, account.filterLife);
  }

  // --- Reading a purifier ------------------------------------------------------

  /** Read one purifier and publish what changed. Errors are logged, then thrown. */
  async function readPurifier(gladysDevice) {
    const device = byExternalId.get(gladysDevice.external_id);
    if (!device) {
      return;
    }
    const ids = idsOf(gladys, device);
    const features = featuresOf(gladysDevice.external_id, device);
    const name = deviceName(device);
    let attributes;
    try {
      attributes = await api.getAttributes(device.deviceId);
    } catch (err) {
      if (err instanceof WinixOfflineError) {
        issues.ok('cloud', 'Winix cloud answers again');
        if (online.get(device.deviceId) !== false) {
          logger.info(`${name} is offline`);
        }
        online.set(device.deviceId, false);
        await gladys.publishChangedStates(offlineStates(ids, features), {
          heartbeat: HEARTBEAT_MS,
        });
        return;
      }
      issues.fail('cloud', `Reading the purifiers failed (${err.message})`);
      await reportStatus(statusKeyOf(err));
      throw err;
    }
    issues.ok('cloud', 'Winix cloud answers again');
    if (online.get(device.deviceId) === false) {
      logger.info(`${name} is back online`);
    }
    online.set(device.deviceId, true);
    attributesCache.set(device.deviceId, attributes);
    if (!account.authError) {
      await reportStatus('ok');
    }
    if (await account.rememberAttributeKeys(device.deviceId, Object.keys(attributes))) {
      // A sensor appeared: the Discovery tab will offer "Update".
      await publishDevices();
    }
    const states = statesFromAttributes(ids, attributes, {
      features,
      lifeHours: lifeHoursOf(device),
    });
    logger.debug(`${name}: ${JSON.stringify(parseAttributes(attributes))}`);
    const result = await gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
    if (result?.count > 0) {
      gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  // --- Commands ----------------------------------------------------------------

  /** What a feature command asks, in purifier terms. */
  function wishOf(featureKey, value) {
    switch (featureKey) {
      case FEATURE.POWER:
        return { power: Number(value) === 1 };
      case FEATURE.PLASMAWAVE:
        return { plasmawave: Number(value) === 1 };
      case FEATURE.MODE:
        return { mode: String(value) };
      case FEATURE.FAN_SPEED:
        return { speed: Math.round(Number(value)) };
      default:
        return null;
    }
  }

  function localized(text) {
    return text[languageOf(config)];
  }

  /**
   * Run a command on a purifier: the attribute writes, the expected states at
   * once, and a confirmation read a few seconds later.
   */
  async function command(externalId, wish, label) {
    const device = byExternalId.get(externalId);
    if (!device) {
      throw new Error(localized(TEXT.unknownDevice));
    }
    if (!account.identityId) {
      throw new Error(localized(TEXT.notReady));
    }
    const gladysDevice = { external_id: externalId };
    let attributes = attributesCache.get(device.deviceId);
    if (!attributes) {
      await poller.readNow(gladysDevice).catch(() => {});
      attributes = attributesCache.get(device.deviceId);
    }
    if (!attributes || online.get(device.deviceId) === false) {
      throw new Error(localized(TEXT.offline));
    }
    const steps = planCommand(attributes, wish);
    logger.info(`${deviceName(device)}: ${label}`);
    try {
      for (const [attribute, value] of steps) {
        await api.setAttribute(device.deviceId, account.identityId, attribute, value);
      }
    } catch (err) {
      if (err instanceof WinixOfflineError) {
        throw new Error(localized(TEXT.offline), { cause: err });
      }
      logger.error(`${deviceName(device)}: command failed (${err.message})`);
      throw new Error(
        localized(err instanceof WinixRateLimitError ? STATUS.rateLimited : STATUS.unreachable),
        { cause: err },
      );
    }
    const next = applySteps(attributes, steps);
    attributesCache.set(device.deviceId, next);
    const ids = idsOf(gladys, device);
    await gladys
      .publishChangedStates(
        statesFromAttributes(ids, next, {
          features: featuresOf(externalId, device),
          lifeHours: lifeHoursOf(device),
        }),
      )
      .catch((err) => logger.debug(`States after the command not sent (${err.message})`));
    scheduleConfirmation(gladysDevice);
  }

  function scheduleConfirmation(gladysDevice) {
    if (!timers) {
      return;
    }
    const timer = setTimeout(() => {
      confirmTimers.delete(timer);
      poller.readNow(gladysDevice).catch(() => {});
    }, CONFIRM_DELAY_MS);
    confirmTimers.add(timer);
  }

  async function onSetValue(gladysDevice, feature, value) {
    const key = featureKeyOf(feature.external_id);
    const wish = wishOf(key, value);
    if (!wish) {
      throw new Error(`${feature.external_id} cannot be controlled`);
    }
    await command(gladysDevice.external_id, wish, `${key} = ${value}`);
    gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  // --- Dashboard widget ------------------------------------------------------

  /** The content of the purifier widget, from what the purifier reported last. */
  async function widgetContent({ settings, language }) {
    const lang = LANGUAGES.includes(language) ? language : languageOf(config);
    const caption = (text) => ({
      ttl_seconds: 60,
      components: [{ type: 'text', variant: 'caption', text: text[lang] }],
    });
    const device = byExternalId.get(settings?.device);
    if (!device) {
      return caption(TEXT.pickPurifier);
    }
    if (!account.identityId) {
      return caption(TEXT.notReady);
    }
    if (!attributesCache.has(device.deviceId) && online.get(device.deviceId) === undefined) {
      await poller.readNow({ external_id: settings.device }).catch(() => {});
    }
    return buildWidgetContent({
      lang,
      ids: idsOf(gladys, device),
      features: featuresOf(settings.device, device),
      attributes: attributesCache.get(device.deviceId) ?? null,
      online: online.get(device.deviceId),
      lifeHours: lifeHoursOf(device),
      name: deviceName(device),
    });
  }

  /** The widget buttons: their action key is the command. */
  const WIDGET_ACTIONS = {
    power_on: { power: true },
    power_off: { power: false },
    mode_auto: { mode: 'auto' },
    mode_manual: { mode: 'manual' },
    mode_sleep: { mode: 'sleep' },
  };

  async function widgetAction(actionKey, params, { settings }) {
    const wish = WIDGET_ACTIONS[actionKey];
    if (!wish) {
      throw new Error(`Unknown widget action ${actionKey}`);
    }
    await command(settings?.device, wish, `widget ${actionKey}`);
    return TEXT.done;
  }

  // --- Lifecycle ---------------------------------------------------------------

  /** Take a (new) configuration into account. */
  async function applyConfig(next, { credentialsChanged }) {
    config = next;
    if (!isConfigured(config)) {
      poller.stop();
      logger.info('Not configured yet: waiting for the Winix e-mail address and password');
      await reportStatus('notConfigured');
      return;
    }
    await account.setCredentials({ username: config.username, password: config.password });
    // New credentials are checked at once; the same ones need no sign-in.
    const ready = await setup({ force: credentialsChanged });
    await publishDevices();
    if (ready && !account.authError) {
      await reportStatus('ok');
    }
    await poller.restart();
  }

  function stopTimers() {
    poller.stop();
    for (const timer of confirmTimers) {
      clearTimeout(timer);
    }
    confirmTimers.clear();
  }

  return {
    /** Register every handler on the Gladys client (before connect()). */
    register() {
      gladys.onScanRequest(async () => {
        logger.info('Scan requested: listing the purifiers of the Winix account');
        if (isConfigured(config) && (await setup({ force: true })) && !account.authError) {
          await reportStatus('ok');
        }
        await publishDevices();
      });
      gladys.onSetValue(onSetValue);
      poller.register(async () => {
        gladys.requestWidgetRefresh(WIDGET_KEY);
      });
      gladys.onWidgetGet(WIDGET_KEY, (request) => widgetContent(request));
      gladys.onWidgetAction(WIDGET_KEY, (actionKey, params, context) =>
        widgetAction(actionKey, params, context),
      );
      gladys.onConfigUpdated(async (raw) => {
        const next = normalizeConfig(raw);
        const credentialsChanged =
          next.username !== config.username || next.password !== config.password;
        logger.info('Configuration updated');
        await applyConfig(next, { credentialsChanged });
      });
      gladys.on('connected', async () => {
        try {
          const next = normalizeConfig(await gladys.getConfig());
          // On a reconnection, the same credentials need no new sign-in.
          await applyConfig(next, { credentialsChanged: false });
        } catch (err) {
          logger.error(`Post-connection initialization failed: ${err.message}`);
          lastStatus = null;
          await reportStatus('initFailed');
        }
      });
      gladys.on('disconnected', () => stopTimers());
      gladys.handleShutdown(async (signal) => {
        logger.info(`Received ${signal}: shutting down`);
        stopTimers();
      });
    },

    stop: stopTimers,

    /** For the tests. */
    get config() {
      return config;
    },
  };
}

/**
 * The widget content for one purifier: a heading, the PM2.5 and filter tiles
 * (live, bound to the device features), a status list and up to four buttons.
 * The current mode is marked by its icon, not by a style (invisible in dark
 * mode, see CLAUDE.md).
 */
export function buildWidgetContent({ lang, ids, features, attributes, online, lifeHours, name }) {
  const components = [{ type: 'text', variant: 'heading', text: name.slice(0, 40) }];
  if (features.has(FEATURE.PM25)) {
    components.push({ type: 'value', device_feature: ids.feature(FEATURE.PM25) });
  }
  if (features.has(FEATURE.FILTER_LIFE)) {
    components.push({ type: 'gauge', device_feature: ids.feature(FEATURE.FILTER_LIFE) });
  }
  if (online === false) {
    components.push({
      type: 'status',
      items: [
        { label: TEXT.rowState[lang], value: TEXT.stateOffline[lang], color: WIDGET_COLORS.DANGER },
      ],
    });
    return { ttl_seconds: 60, components };
  }
  if (!attributes) {
    components.push({ type: 'text', variant: 'caption', text: TEXT.noValueYet[lang] });
    return { ttl_seconds: 60, components };
  }

  const values = parseAttributes(attributes);
  const items = [];
  if (values.power === false) {
    items.push({
      label: TEXT.rowState[lang],
      value: TEXT.stateOff[lang],
      color: WIDGET_COLORS.NEUTRAL,
    });
  } else if (values.mode) {
    items.push({
      label: TEXT.rowMode[lang],
      value: MODE_LABELS[lang][values.mode],
      color: WIDGET_COLORS.PRIMARY,
    });
  }
  if (values.airQuality !== null) {
    const colors = [
      WIDGET_COLORS.SUCCESS,
      WIDGET_COLORS.WARNING,
      WIDGET_COLORS.DANGER,
      WIDGET_COLORS.DANGER,
    ];
    items.push({
      label: TEXT.rowAir[lang],
      value: AIR_QUALITY_LABELS[lang][values.airQuality],
      color: colors[values.airQuality],
    });
  }
  const remaining = filterRemaining(values.filterHoursUsed, lifeHours);
  if (remaining) {
    items.push({
      label: TEXT.rowFilter[lang],
      value: filterSummary(remaining),
      color: remaining.percent <= 10 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    });
  }
  if (items.length > 0) {
    components.push({ type: 'status', items });
  }

  if (values.power === false) {
    components.push({
      type: 'button',
      label: TEXT.buttonOn[lang],
      icon: 'power',
      action: { key: 'power_on' },
    });
    return { ttl_seconds: 60, components };
  }
  for (const mode of ['auto', 'manual', 'sleep']) {
    components.push({
      type: 'button',
      label: MODE_LABELS[lang][mode],
      icon:
        values.mode === mode
          ? 'check-circle'
          : { auto: 'refresh-cw', manual: 'sliders', sleep: 'moon' }[mode],
      style: 'secondary',
      action: { key: `mode_${mode}` },
    });
  }
  components.push({
    type: 'button',
    label: TEXT.buttonOff[lang],
    icon: 'power',
    style: 'secondary',
    action: { key: 'power_off' },
  });
  return { ttl_seconds: 60, components };
}

/** The Gladys device type of the purifiers, for the tests. */
export { DEVICE_TYPE };
