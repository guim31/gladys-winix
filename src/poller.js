// -----------------------------------------------------------------------------
// The container's own refresh timer.
//
// The purifiers are published with `should_poll: true` and a poll frequency
// of one minute, but the core cannot be trusted to call onPoll: Gladys 5.2
// skips devices created without `should_poll`, and a device keeps the polling
// fields it was created with (GladysAssistant/Gladys#3198). So the container
// reads the purifiers by itself, at the configured interval (1 to 5 minutes),
// and the core's onPoll stays as a fallback.
//
// No double reading: the timer skips a purifier read less than half an
// interval ago, and the core's onPoll skips one read less than 90 % of an
// interval ago — while the timer runs, the core never reaches the Winix
// cloud; it takes over only if the timer stalls.
//
// Only the purifiers the user added to Gladys are read (`gladys.devices`):
// the core drops the states of a device it does not know. They are read one
// after the other, never in a burst: the Winix cloud answers a burst with a
// minute of refusals.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { refreshIntervalMs } from './config.js';

const logger = createLogger({ name: 'poller' });

/**
 * @param {object} options
 * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
 * @param {() => object} options.getConfig the current normalized config
 * @param {(device: object) => boolean} options.owns whether a Gladys device is one of ours
 * @param {(device: object) => Promise<void>} options.read reads one purifier, publishes its states
 * @param {() => Promise<void>} [options.beforeCycle] runs first at every cycle (setup retries)
 * @param {boolean} [options.timers] run the periodic timer (tests may turn it off)
 * @param {() => number} [options.now]
 */
export function createPoller({
  gladys,
  getConfig,
  owns,
  read,
  beforeCycle = async () => {},
  timers = true,
  now = () => Date.now(),
}) {
  /** When each device was last read (start of the read), by external id. */
  const lastReadAt = new Map();
  /** Reads in progress, by external id: a second caller waits for the same one. */
  const inFlight = new Map();
  let timer = null;
  let stopped = false;

  const periodMs = () => refreshIntervalMs(getConfig());

  async function readDevice(device, { force = false, minGap = 0.5 } = {}) {
    const key = device.external_id;
    let running = inFlight.get(key);
    while (running && force) {
      await running.catch(() => {});
      running = inFlight.get(key);
    }
    if (running) {
      return running;
    }
    const last = lastReadAt.get(key);
    if (!force && last !== undefined && now() - last < periodMs() * minGap) {
      logger.debug(`${key}: read ${now() - last} ms ago, skipped`);
      return undefined;
    }
    lastReadAt.set(key, now());
    const run = read(device);
    inFlight.set(key, run);
    try {
      return await run;
    } finally {
      inFlight.delete(key);
    }
  }

  /** One cycle: every added purifier, one after the other, errors swallowed. */
  async function cycle({ force = false } = {}) {
    if (gladys.connected === false) {
      logger.debug('Gladys unreachable: refresh skipped');
      return;
    }
    await beforeCycle();
    for (const device of (gladys.devices ?? []).filter(owns)) {
      if (stopped && !force) {
        return;
      }
      await readDevice(device, { force }).catch(() => {});
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (!timers || stopped) {
      return;
    }
    timer = setTimeout(async () => {
      timer = null;
      try {
        await cycle();
      } catch (err) {
        logger.error(`Refresh cycle failed (${err.message})`);
      } finally {
        schedule();
      }
    }, periodMs());
  }

  const api = {
    /**
     * Register the polling handlers: the core's onPoll (fallback), and an
     * immediate read of a purifier the user just added or updated — the SDK
     * forgot what it had published for it, everything is sent again now.
     * @param {(device: object) => Promise<void>} [onAdded] runs after that read
     */
    register(onAdded = async () => {}) {
      gladys.onPoll((device) => api.pollFromCore(device));
      const added = async (device) => {
        if (!owns(device)) {
          return;
        }
        await readDevice(device, { force: true }).catch(() => {});
        await onAdded(device);
      };
      gladys.onDeviceCreated(added);
      gladys.onDeviceUpdated(added);
    },

    /** (Re)start: forget the previous reads, read every purifier now, then every interval. */
    async restart() {
      stopped = false;
      lastReadAt.clear();
      schedule();
      await cycle({ force: true });
    },

    /** The core's onPoll (fallback): reads the purifier unless the timer just did. */
    async pollFromCore(device) {
      if (!owns(device)) {
        logger.debug(`onPoll ignored for ${device.external_id}`);
        return;
      }
      await readDevice(device, { minGap: 0.9 });
    },

    /** Read one purifier now (after a command, to confirm its new state). */
    async readNow(device) {
      await readDevice(device, { force: true });
    },

    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = null;
    },
  };
  return api;
}
