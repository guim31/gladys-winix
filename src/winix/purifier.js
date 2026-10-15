// -----------------------------------------------------------------------------
// What a Winix purifier says, and how to make it do something.
//
// The device API speaks in attribute codes (A02 power, A03 mode, A04 airflow,
// A07 Plasmawave, A21 filter hours, S04 PM2.5, S07 air quality, S14 ambient
// light), with the values the app sends: '0'/'1', '01'/'02'... The codes are
// those documented by the winix projects (see the README credits); this module
// turns them into plain values and back, without any I/O.
// -----------------------------------------------------------------------------

export const ATTR = {
  POWER: 'A02',
  MODE: 'A03',
  AIRFLOW: 'A04',
  PLASMA: 'A07',
  FILTER_HOURS: 'A21',
  PM25: 'S04',
  AIR_QUALITY: 'S07',
  AMBIENT_LIGHT: 'S14',
};

/** Purifier modes, as the Winix app shows them: sleep is an airflow of the manual mode. */
export const MODES = ['auto', 'manual', 'sleep'];

// Fan speed levels published in Gladys: 0 is the sleep airflow (the quietest),
// then low, medium, high, turbo — and Super Clean on the Tower Prime.
const AIRFLOW_TO_SPEED = { '06': 0, '01': 1, '02': 2, '03': 3, '05': 4, '08': 5 };
const SPEED_TO_AIRFLOW = Object.fromEntries(
  Object.entries(AIRFLOW_TO_SPEED).map(([code, speed]) => [speed, code]),
);
const SLEEP_AIRFLOW = '06';

/** The fastest speed of a model: 5 (Super Clean) on the Tower Prime, 4 (turbo) elsewhere. */
export function maxSpeed(modelName) {
  return /tower\s*prime/i.test(modelName ?? '') ? 5 : 4;
}

// Winix shows the air quality with a colored ring: good (blue), fair
// (purple), poor (red) and, on some models, very poor. Gladys gets it on the
// 0-3 scale of its risk badge: 0 good, 1 fair, 2 poor, 3 very poor.
const AIR_QUALITY_LEVELS = { '01': 0, '02': 1, '03': 2, '04': 3 };

/** @returns {number|null} 0 (good) to 3 (very poor) */
export function airQualityLevel(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  if (AIR_QUALITY_LEVELS[raw] !== undefined) {
    return AIR_QUALITY_LEVELS[raw];
  }
  // Some firmwares send the level as a decimal ("1.0", "2.3"): same scale, 1-based.
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return null;
  }
  if (value >= 3.1) {
    return 3;
  }
  if (value >= 2.1) {
    return 2;
  }
  return value >= 1.1 ? 1 : 0;
}

function integer(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function binary(raw) {
  if (raw === '1') {
    return true;
  }
  return raw === '0' ? false : null;
}

/**
 * Plain values out of the raw attributes; null for what the purifier does
 * not report.
 * @param {Record<string, string>} attributes
 */
export function parseAttributes(attributes) {
  const airflow = attributes[ATTR.AIRFLOW];
  let mode = null;
  if (airflow === SLEEP_AIRFLOW) {
    mode = 'sleep';
  } else if (attributes[ATTR.MODE] === '01') {
    mode = 'auto';
  } else if (attributes[ATTR.MODE] === '02') {
    mode = 'manual';
  }
  return {
    power: binary(attributes[ATTR.POWER]),
    mode,
    speed: AIRFLOW_TO_SPEED[airflow] ?? null,
    plasmawave: binary(attributes[ATTR.PLASMA]),
    filterHoursUsed: integer(attributes[ATTR.FILTER_HOURS]),
    airQuality: airQualityLevel(attributes[ATTR.AIR_QUALITY]),
    pm25: integer(attributes[ATTR.PM25]),
    ambientLight: integer(attributes[ATTR.AMBIENT_LIGHT]),
  };
}

/** Default filter life when the model is unknown: 9 months of 24 h days. */
export const DEFAULT_FILTER_LIFE_HOURS = 6480;

/**
 * Filter life by model id, used when the cloud does not send its own table.
 * Values from the iprak/winix Home Assistant integration (MIT).
 */
export const MODEL_FILTER_LIFE_HOURS = {
  t500_au: 6480,
  c610_au: 6480,
  t800_au: 6480,
  t1000_au: 6480,
  '5520_au': 6480,
  c5_au: 6480,
  c710_us: 6480,
  a400_us: 6480,
  '5530_us': 6480,
  '5520_us': 6480,
  '5510_us': 6480,
  c610_us: 6480,
  c545: 6480,
  c909: 6480,
  t800_us: 6480,
  t500_us: 6480,
  9800: 6480,
  azsuus: 8640,
  zeros_eu: 6480,
  t500_eu: 6480,
  t800_eu: 6480,
  zeros_gb: 6480,
  t500_gb: 6480,
  t800_gb: 6480,
  t1000_pps: 6480,
  tower_q: 8640,
  azpueu: 8640,
  xq: 8640,
  xq20: 8640,
  xqlaser: 8640,
  c5: 6480,
};

/**
 * Filter life of a model, in hours.
 * @param {string} modelId
 * @param {Record<string, number>} [cloudTable] the table the cloud sent, lowercased ids
 */
export function filterLifeHours(modelId, cloudTable = {}) {
  const key = String(modelId ?? '').toLowerCase();
  return cloudTable[key] ?? MODEL_FILTER_LIFE_HOURS[key] ?? DEFAULT_FILTER_LIFE_HOURS;
}

/**
 * What is left of the filter: hours, and percent of its life (0 once due).
 * @returns {{ hours: number, percent: number } | null}
 */
export function filterRemaining(hoursUsed, lifeHours) {
  if (hoursUsed === null || !Number.isFinite(hoursUsed) || !(lifeHours > 0)) {
    return null;
  }
  const hours = Math.max(0, Math.round(lifeHours - hoursUsed));
  return { hours, percent: Math.max(0, Math.min(100, Math.round((hours * 100) / lifeHours))) };
}

/**
 * The attribute writes that bring the purifier to what was asked, given what
 * it reports now. Each step is [attribute, value]; the purifier is switched
 * on first when a mode or a speed is asked while it is off, as the app does.
 * @param {Record<string, string>} attributes the current raw attributes
 * @param {{ power?: boolean, mode?: string, speed?: number, plasmawave?: boolean }} wish
 * @returns {Array<[string, string]>}
 */
export function planCommand(attributes, wish) {
  const steps = [];
  const isOn = attributes[ATTR.POWER] === '1';
  const ensureOn = () => {
    if (!isOn) {
      steps.push([ATTR.POWER, '1']);
    }
  };

  if (wish.power !== undefined) {
    steps.push([ATTR.POWER, wish.power ? '1' : '0']);
  } else if (wish.plasmawave !== undefined) {
    steps.push([ATTR.PLASMA, wish.plasmawave ? '1' : '0']);
  } else if (wish.mode !== undefined) {
    if (!MODES.includes(wish.mode)) {
      throw new RangeError(`Unknown mode "${wish.mode}"`);
    }
    ensureOn();
    if (wish.mode === 'auto') {
      steps.push([ATTR.MODE, '01']);
    } else if (wish.mode === 'sleep') {
      steps.push([ATTR.AIRFLOW, SLEEP_AIRFLOW]);
    } else {
      // Manual: the sleep airflow already is a manual mode, leave it for low.
      steps.push([ATTR.MODE, '02']);
      if (attributes[ATTR.AIRFLOW] === SLEEP_AIRFLOW) {
        steps.push([ATTR.AIRFLOW, '01']);
      }
    }
  } else if (wish.speed !== undefined) {
    const code = SPEED_TO_AIRFLOW[wish.speed];
    if (code === undefined) {
      throw new RangeError(`Unknown fan speed ${wish.speed}`);
    }
    ensureOn();
    // A speed is a manual setting: the purifier leaves auto for it.
    if (code !== SLEEP_AIRFLOW && attributes[ATTR.MODE] !== '02') {
      steps.push([ATTR.MODE, '02']);
    }
    steps.push([ATTR.AIRFLOW, code]);
  }
  return steps;
}

/**
 * The attributes once the steps are applied, as the purifier reports them
 * (an airflow written leaves auto mode): the states shown right after a
 * command, before the cloud confirms them.
 */
export function applySteps(attributes, steps) {
  const next = { ...attributes };
  for (const [attribute, value] of steps) {
    next[attribute] = value;
    if (attribute === ATTR.AIRFLOW) {
      next[ATTR.MODE] = '02';
    }
    // Leaving sleep for auto: the purifier picks its airflow, low until it says.
    if (attribute === ATTR.MODE && value === '01' && next[ATTR.AIRFLOW] === SLEEP_AIRFLOW) {
      next[ATTR.AIRFLOW] = '01';
    }
  }
  return next;
}
