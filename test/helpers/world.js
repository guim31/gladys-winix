// -----------------------------------------------------------------------------
// The whole integration against the SDK's fake Gladys and the fake Winix
// cloud: what a test needs to act like the user, Gladys or Winix.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createLogger } from '@gladysassistant/integration-sdk';
import { createApp } from '../../src/app.js';
import { createMemoryStore } from '../../src/store.js';
import { createFakeWinix, PASSWORD, USERNAME } from './fakeWinix.js';

export const CONFIG = { username: USERNAME, password: PASSWORD, refresh_interval: 2 };

/**
 * @param {object} [options]
 * @param {object} [options.config] configuration served by the fake Gladys
 * @param {object} [options.store] /data (a memory store by default)
 * @param {object} [options.winix] the fake Winix cloud (a new one by default)
 * @param {boolean} [options.timers] the refresh timer (off by default: tests drive it)
 * @param {boolean} [options.connect] connect at once (default true)
 * @param {object} [options.logger]
 */
export async function createWorld({
  config = CONFIG,
  store = createMemoryStore(),
  winix = createFakeWinix(),
  timers = false,
  connect = true,
  logger = createLogger({ name: 'winix', level: 'silent' }),
  devices = [],
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const app = createApp({
    gladys,
    fetch: winix.fetch,
    store,
    logger,
    timers,
    sleep: async () => {},
  });
  app.register();
  if (connect) {
    await gladys.connect();
  }
  return {
    gladys,
    app,
    store,
    winix,
    /** Add every discovered purifier to Gladys, as the user does in the Discovery tab. */
    async addAll() {
      for (const device of gladys.fake.discoveredDevices) {
        await gladys.fake.deviceCreated(device);
      }
    },
    /** The discovered device of a purifier, by the start of its name. */
    discovered(name) {
      return gladys.fake.discoveredDevices.find((device) => device.name.startsWith(name));
    },
  };
}
