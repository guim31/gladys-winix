// -----------------------------------------------------------------------------
// What the integration keeps across restarts, in /data (the only writable
// place of the container): the Winix session (refresh token, identity id) and
// the list of the purifiers, so a restart reads and controls them without
// signing in again — each sign-in may log the phone app out.
//
// One JSON file, readable by the container user only, written atomically
// (temporary file, then rename) so a crash never leaves half a file.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const DEFAULT_DATA_DIR = '/data';
const FILE_NAME = 'winix-session.json';

/**
 * @param {object} [options]
 * @param {string} [options.dir] defaults to $WINIX_DATA_DIR or /data
 */
export function createStore({ dir = process.env.WINIX_DATA_DIR || DEFAULT_DATA_DIR } = {}) {
  const path = join(dir, FILE_NAME);
  return {
    path,

    /** @returns {Promise<object|null>} null when nothing was saved (or the file is unreadable) */
    async load() {
      try {
        const data = JSON.parse(await readFile(path, 'utf8'));
        return data && typeof data === 'object' ? data : null;
      } catch {
        return null;
      }
    },

    /** @param {object} data */
    async save(data) {
      await mkdir(dir, { recursive: true });
      const temporary = `${path}.tmp`;
      await writeFile(temporary, `${JSON.stringify(data)}\n`, { mode: 0o600 });
      await rename(temporary, path);
    },
  };
}

/** A store in memory, for the tests. */
export function createMemoryStore(initial = null) {
  let data = initial === null ? null : structuredClone(initial);
  return {
    path: ':memory:',
    saves: 0,
    async load() {
      return data === null ? null : structuredClone(data);
    },
    async save(value) {
      data = structuredClone(value);
      this.saves += 1;
    },
    peek() {
      return data;
    },
  };
}
