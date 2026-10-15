// -----------------------------------------------------------------------------
// Every text Gladys shows exists in the four languages of its interface
// (English, French, German, Spanish): the manifest, the message tables of the
// code, the feature names, and the four documentation files, which share the
// same sections. German says "du", never the polite "Sie".
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES } from '../src/config.js';
import { AIR_QUALITY_LABELS, MODE_LABELS, NAMES, STATUS, TEXT } from '../src/i18n.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const LANGS = ['en', 'fr', 'de', 'es'];
const POLITE_GERMAN = /(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)(?!\p{L})/u;

// Upper bounds, in characters: what the Gladys interface shows without cutting.
const MAX = {
  catalog: 100,
  widgetLabel: 30,
  label: 60,
  placeholder: 60,
  description: 300,
  message: 200,
  short: 24,
  featureName: 40,
  status: 40,
};

const sorted = (keys) => [...keys].sort();

/** Checks one multi-language object; returns its problems. */
function problems(value, path, max) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be a multi-language object`];
  }
  const found = [];
  if (JSON.stringify(sorted(Object.keys(value))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${path} has [${Object.keys(value)}], expected exactly [${LANGS}]`);
  }
  for (const [lang, text] of Object.entries(value)) {
    found.push(...textProblems(text, `${path}.${lang}`, lang, max));
  }
  return found;
}

function textProblems(text, path, lang, max) {
  if (typeof text !== 'string' || text.trim() === '') {
    return [`${path} is empty`];
  }
  const found = [];
  if (text.length > max) {
    found.push(`${path} has ${text.length} characters (${max} at most)`);
  }
  if (lang === 'de' && POLITE_GERMAN.test(text)) {
    found.push(`${path} uses the polite form: "${text}"`);
  }
  return found;
}

/** Every multi-language object of the manifest, with its length limit. */
function manifestTexts(root) {
  const texts = [];
  const walk = (value, path, key) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, key));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const isText =
      ['label', 'description', 'placeholder'].includes(key) ||
      Object.keys(value).some((child) => LANGS.includes(child));
    if (isText) {
      // The store schema caps the catalog and widget descriptions, and widget labels.
      const max =
        path === 'manifest.description' || /^manifest\.widgets\[\d+\]\.description$/.test(path)
          ? MAX.catalog
          : /^manifest\.widgets\[\d+\]\.label$/.test(path)
            ? MAX.widgetLabel
            : (MAX[key] ?? MAX.label);
      texts.push({ path, value, max });
      return;
    }
    for (const [child, item] of Object.entries(value)) {
      walk(item, `${path}.${child}`, child);
    }
  };
  walk(root, 'manifest', null);
  return texts;
}

// Tables written one language at a time: same keys everywhere, no empty text.
function tableProblems(table, name, max) {
  const found = [];
  if (JSON.stringify(sorted(Object.keys(table))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${name} has [${Object.keys(table)}], expected exactly [${LANGS}]`);
  }
  for (const lang of LANGS) {
    const entries = table[lang] ?? {};
    if (
      JSON.stringify(sorted(Object.keys(entries))) !== JSON.stringify(sorted(Object.keys(table.en)))
    ) {
      found.push(`${name}.${lang} does not have the keys of ${name}.en`);
    }
    for (const [key, value] of Object.entries(entries)) {
      found.push(...textProblems(value, `${name}.${lang}.${key}`, lang, max));
    }
  }
  return found;
}

test('the configuration offers the four languages', () => {
  assert.deepEqual(LANGUAGES, LANGS);
});

test('every text of the manifest is in English, French, German and Spanish', () => {
  const texts = manifestTexts(manifest);
  assert.ok(texts.length >= 19, `only ${texts.length} texts found in the manifest`);
  const found = texts.flatMap(({ path, value, max }) => problems(value, path, max));
  assert.deepEqual(found, []);
});

test('the name is the brand, the same in every language', () => {
  assert.equal(manifest.name, 'Winix');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
});

test('every message of the code has the four languages', () => {
  const short = new Set(Object.keys(TEXT).filter((key) => /^(row|state|button)/.test(key)));
  const found = [
    ...Object.entries(STATUS).flatMap(([key, value]) =>
      problems(value, `STATUS.${key}`, MAX.message),
    ),
    ...Object.entries(TEXT).flatMap(([key, value]) =>
      problems(value, `TEXT.${key}`, short.has(key) ? MAX.short : MAX.message),
    ),
  ];
  assert.deepEqual(found, []);
});

test('the feature names, modes and air quality levels exist in every language', () => {
  assert.deepEqual(tableProblems(NAMES, 'NAMES', MAX.featureName), []);
  assert.deepEqual(tableProblems(MODE_LABELS, 'MODE_LABELS', MAX.short), []);
  for (const lang of LANGS) {
    assert.equal(AIR_QUALITY_LABELS[lang].length, 4, `AIR_QUALITY_LABELS.${lang}`);
    for (const label of AIR_QUALITY_LABELS[lang]) {
      assert.deepEqual(textProblems(label, `AIR_QUALITY_LABELS.${lang}`, lang, MAX.status), []);
    }
  }
  // Distinct names on a device (Gladys shows them side by side).
  for (const lang of LANGS) {
    const names = Object.values(NAMES[lang]);
    assert.equal(new Set(names).size, names.length, `NAMES.${lang} has twice the same name`);
  }
});

test('the guard catches a missing language, an empty text and the polite German form', () => {
  assert.equal(problems({ en: 'Power', fr: 'Marche', de: 'Betrieb' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: '', es: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a', es: 'a', it: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a'.repeat(61), es: 'a' }, 'x', 60).length, 1);
  for (const polite of ['Wählen Sie', 'Ihr Konto', 'Ihre Daten', 'mit Ihrem', 'Ihren', 'Ihrer']) {
    assert.equal(problems({ en: 'a', fr: 'a', de: polite, es: 'a' }, 'x', 60).length, 1, polite);
  }
  assert.deepEqual(
    problems({ en: 'a', fr: 'a', de: 'Siebenschläfer, ihre', es: 'a' }, 'x', 60),
    [],
  );
  const forgotten = structuredClone(manifest);
  delete forgotten.config_schema[1].placeholder.de;
  assert.deepEqual(
    manifestTexts(forgotten).flatMap(({ path, value, max }) => problems(value, path, max)),
    ['manifest.config_schema[1].placeholder has [en,fr,es], expected exactly [en,fr,de,es]'],
  );
});

// --- Documentation -----------------------------------------------------------

const docs = Object.fromEntries(
  await Promise.all(
    LANGS.map(async (lang) => [
      lang,
      await readFile(new URL(`../docs/${lang}.md`, import.meta.url), 'utf8'),
    ]),
  ),
);

/** The outline of a document: the level of each heading, in order. */
function outline(markdown) {
  return markdown
    .split('\n')
    .filter((line) => /^#{1,4} /.test(line))
    .map((line) => line.match(/^#+/)[0].length);
}

test('the four documentation files have the same sections', () => {
  const reference = outline(docs.en);
  assert.ok(reference.filter((level) => level === 2).length >= 8, 'the sections of the brief');
  for (const lang of LANGS) {
    assert.deepEqual(outline(docs[lang]), reference, `docs/${lang}.md does not follow docs/en.md`);
    assert.ok(docs[lang].trim().length >= 300, `docs/${lang}.md is too short for the store`);
  }
});

test('the documentation says it was developed without the hardware, and is not Winix', () => {
  const marks = {
    en: [/without the hardware/i, /not affiliated with Winix/i],
    fr: [/sans le matériel/i, /aucun lien avec Winix/i],
    de: [/ohne die Hardware/i, /nicht mit Winix verbunden/i],
    es: [/sin el hardware/i, /no está afiliada a Winix/i],
  };
  for (const lang of LANGS) {
    for (const mark of marks[lang]) {
      assert.match(docs[lang], mark, `docs/${lang}.md`);
    }
  }
});

test('the German documentation says "du"', () => {
  assert.equal(POLITE_GERMAN.test(docs.de), false, docs.de.match(POLITE_GERMAN)?.[0]);
});

test('the guard catches documentation files that drift apart', () => {
  assert.notDeepEqual(outline('# A\n## B\n## C'), outline('# A\n## B\n### C'));
});
