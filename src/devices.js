// -----------------------------------------------------------------------------
// One Gladys device per Winix air purifier: its features, and the states they
// take from what the purifier reports.
//
// External ids are built from the MAC address of the purifier (stable, unique)
// — never from its name, nor from the Winix device id, whose suffix changes
// when the purifier is paired again. Feature keys are forever.
//
// The features follow what the purifier reports: PM2.5 and ambient light only
// on the models that have the sensor. Before the first reading, the common set
// is published; a later scan offers "Update" in the Discovery tab when a sensor
// shows up.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { MODE_LABELS, NAMES } from './i18n.js';
import {
  ATTR,
  MODES,
  filterLifeHours,
  filterRemaining,
  maxSpeed,
  parseAttributes,
} from './winix/purifier.js';

export const DEVICE_TYPE = 'purifier';

/** Feature keys: stable, they end up in the external ids. */
export const FEATURE = {
  POWER: 'power',
  MODE: 'mode',
  FAN_SPEED: 'fan-speed',
  PLASMAWAVE: 'plasmawave',
  AIR_QUALITY: 'air-quality',
  PM25: 'pm25',
  AMBIENT_LIGHT: 'ambient-light',
  FILTER_LIFE: 'filter-life',
  FILTER_HOURS: 'filter-hours',
  ONLINE: 'online',
};

// The attribute each optional feature needs. Power, mode, speed and online are
// always there: they are the purifier itself.
const OPTIONAL = [
  [FEATURE.PLASMAWAVE, ATTR.PLASMA],
  [FEATURE.AIR_QUALITY, ATTR.AIR_QUALITY],
  [FEATURE.PM25, ATTR.PM25],
  [FEATURE.AMBIENT_LIGHT, ATTR.AMBIENT_LIGHT],
  [FEATURE.FILTER_LIFE, ATTR.FILTER_HOURS],
  [FEATURE.FILTER_HOURS, ATTR.FILTER_HOURS],
];

// Before any reading: what every Winix purifier of the HA fixtures reports.
const DEFAULT_ATTRIBUTES = [ATTR.PLASMA, ATTR.AIR_QUALITY, ATTR.FILTER_HOURS];

/** The platform id of a purifier: its MAC address, hex digits only. */
export function platformId(device) {
  return device.mac.toLowerCase().replace(/[^0-9a-f]/g, '');
}

/** The ids of one purifier. */
export function idsOf(gladys, device) {
  return gladys.externalIds(DEVICE_TYPE, platformId(device));
}

/** The name proposed in the Discovery tab: the name given in the Winix app. */
export function deviceName(device) {
  return device.alias || `Winix ${device.modelName || device.modelId}`.trim();
}

/** Which optional features a purifier has, from the attribute codes it reports. */
export function featureKeys(attributeKeys) {
  const reported = new Set(attributeKeys ?? DEFAULT_ATTRIBUTES);
  return [
    FEATURE.POWER,
    FEATURE.MODE,
    FEATURE.FAN_SPEED,
    ...OPTIONAL.filter(([, attribute]) => reported.has(attribute)).map(([key]) => key),
    FEATURE.ONLINE,
  ];
}

/**
 * The Gladys device of a purifier.
 * @param {object} gladys the SDK client (for the external ids)
 * @param {object} device normalized Winix device (src/winix/account.js)
 * @param {object} options
 * @param {string} options.language feature names and mode labels
 * @param {string[]|null} options.attributeKeys codes the purifier reported last
 * @param {Record<string, number>} [options.filterLife] filter life table of the cloud
 */
export function buildDevice(gladys, device, { language, attributeKeys, filterLife = {} }) {
  const ids = idsOf(gladys, device);
  const names = NAMES[language];
  const control = { read_only: false, has_feedback: true };
  const sensor = { read_only: true, has_feedback: false };
  const lifeHours = filterLifeHours(device.modelId, filterLife);

  const definitions = {
    [FEATURE.POWER]: {
      category: CATEGORIES.SWITCH,
      type: TYPES.SWITCH.BINARY,
      min: 0,
      max: 1,
      ...control,
    },
    [FEATURE.MODE]: {
      category: CATEGORIES.TEXT,
      type: TYPES.TEXT.SELECT,
      // A text feature still needs min/max (NOT NULL in the core database).
      min: 0,
      max: 0,
      supported_options: MODES.map((mode, index) => ({
        value: mode,
        label: MODE_LABELS[language][mode],
        sort_order: index,
      })),
      ...control,
    },
    [FEATURE.FAN_SPEED]: {
      category: CATEGORIES.FAN,
      type: TYPES.FAN.SPEED,
      min: 0,
      max: maxSpeed(device.modelName),
      ...control,
    },
    [FEATURE.PLASMAWAVE]: {
      category: CATEGORIES.SWITCH,
      type: TYPES.SWITCH.BINARY,
      min: 0,
      max: 1,
      ...control,
    },
    [FEATURE.AIR_QUALITY]: {
      category: CATEGORIES.RISK,
      type: TYPES.RISK.INTEGER,
      min: 0,
      max: 3,
      ...sensor,
    },
    [FEATURE.PM25]: {
      category: CATEGORIES.PM25_SENSOR,
      type: TYPES.SENSOR.DECIMAL,
      unit: UNITS.MICROGRAM_PER_CUBIC_METER,
      min: 0,
      max: 1000,
      ...sensor,
    },
    [FEATURE.AMBIENT_LIGHT]: {
      // The raw reading of the sensor: Winix gives no unit.
      category: CATEGORIES.LIGHT_SENSOR,
      type: TYPES.SENSOR.DECIMAL,
      min: 0,
      max: 10000,
      ...sensor,
    },
    [FEATURE.FILTER_LIFE]: {
      category: CATEGORIES.HEPA_FILTER_MONITORING,
      type: TYPES.FILTER_MONITORING.FILTER_LIFE_REMAINING,
      unit: UNITS.PERCENT,
      min: 0,
      max: 100,
      ...sensor,
    },
    [FEATURE.FILTER_HOURS]: {
      category: CATEGORIES.DURATION,
      type: TYPES.DURATION.INTEGER,
      unit: UNITS.HOURS,
      min: 0,
      max: lifeHours,
      ...sensor,
    },
    [FEATURE.ONLINE]: {
      // input/binary: a plain yes/no the dashboard labels (see CLAUDE.md).
      category: CATEGORIES.INPUT,
      type: TYPES.INPUT.BINARY,
      min: 0,
      max: 1,
      ...sensor,
    },
  };

  const nameOf = {
    [FEATURE.POWER]: names.power,
    [FEATURE.MODE]: names.mode,
    [FEATURE.FAN_SPEED]: names.fanSpeed,
    [FEATURE.PLASMAWAVE]: names.plasmawave,
    [FEATURE.AIR_QUALITY]: names.airQuality,
    [FEATURE.PM25]: names.pm25,
    [FEATURE.AMBIENT_LIGHT]: names.ambientLight,
    [FEATURE.FILTER_LIFE]: names.filterLife,
    [FEATURE.FILTER_HOURS]: names.filterHours,
    [FEATURE.ONLINE]: names.online,
  };

  return {
    name: deviceName(device),
    external_id: ids.device,
    model: device.modelName || device.modelId,
    // The container polls by itself (src/poller.js); the core's poll, every
    // minute, is the fallback (Gladys#3198).
    should_poll: true,
    poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES,
    params: [
      { name: 'model', value: device.modelName || device.modelId },
      { name: 'model_id', value: device.modelId },
      { name: 'firmware', value: device.firmware || '-' },
    ],
    features: featureKeys(attributeKeys).map((key) => ({
      name: nameOf[key],
      external_id: ids.feature(key),
      ...definitions[key],
    })),
  };
}

/**
 * The states of a purifier from its raw attributes, for publishChangedStates.
 * Only the features the device has (`features`) get a state.
 * @param {object} ids externalIds of the purifier
 * @param {Record<string, string>} attributes
 * @param {object} options
 * @param {Set<string>} options.features feature keys of the device in Gladys
 * @param {number} options.lifeHours filter life of the model
 */
export function statesFromAttributes(ids, attributes, { features, lifeHours }) {
  const values = parseAttributes(attributes);
  const states = [];
  const add = (key, state) => {
    if (features.has(key) && state !== null && state !== undefined) {
      states.push({ device_feature_external_id: ids.feature(key), state });
    }
  };
  add(FEATURE.ONLINE, 1);
  add(FEATURE.POWER, values.power === null ? null : Number(values.power));
  if (features.has(FEATURE.MODE) && values.mode !== null) {
    states.push({ device_feature_external_id: ids.feature(FEATURE.MODE), text: values.mode });
  }
  add(FEATURE.FAN_SPEED, values.speed);
  add(FEATURE.PLASMAWAVE, values.plasmawave === null ? null : Number(values.plasmawave));
  add(FEATURE.AIR_QUALITY, values.airQuality);
  add(FEATURE.PM25, values.pm25);
  add(FEATURE.AMBIENT_LIGHT, values.ambientLight);
  const remaining = filterRemaining(values.filterHoursUsed, lifeHours);
  add(FEATURE.FILTER_LIFE, remaining?.percent ?? null);
  add(FEATURE.FILTER_HOURS, remaining?.hours ?? null);
  return states;
}

/** The state of an unreachable purifier: offline, the rest left as it was. */
export function offlineStates(ids, features) {
  return features.has(FEATURE.ONLINE)
    ? [{ device_feature_external_id: ids.feature(FEATURE.ONLINE), state: 0 }]
    : [];
}

/** The feature key of a feature external id of this integration ("…:fan-speed" → "fan-speed"). */
export function featureKeyOf(externalId) {
  return externalId.slice(externalId.lastIndexOf(':') + 1);
}
