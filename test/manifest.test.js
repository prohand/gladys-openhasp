// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { DEFAULT_CONFIG, OBJECT_TYPES } from '../src/config.js';
import {
  PLATE_STATUSES,
  SCENE_ACTIONS,
  SCENE_ACTION_HANDLERS,
  SCENE_TRIGGERS,
  TRIGGER_EVENTS,
} from '../src/capabilities/scenes.js';
import { PLATES_WIDGET } from '../src/capabilities/widget.js';
import { ACTIONS } from '../src/capabilities/actions.js';
import { createApp } from '../src/app.js';
import { LANGUAGES } from '../src/i18n.js';
import { createFakeMqtt } from './helpers/fakeMqtt.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

/** The handlers the integration registers, read from a real (fake) Gladys. */
async function registeredKeys() {
  const gladys = createFakeGladys({ config: {} });
  const app = createApp(gladys, { connect: createFakeMqtt().connect });
  const keys = { actions: [], sceneActions: [], widgets: [] };
  const probe = async (call, list, key) => {
    const ack = await call();
    if (!/not implemented|no handler/i.test(ack.error ?? '')) {
      list.push(key);
    }
  };
  for (const action of manifest.actions) {
    await probe(() => gladys.fake.action(action.key, {}), keys.actions, action.key);
  }
  for (const action of manifest.scene_actions) {
    await probe(() => gladys.fake.sceneAction(action.key, {}), keys.sceneActions, action.key);
  }
  for (const widget of manifest.widgets) {
    await probe(() => gladys.fake.widgetGet(widget.key, {}), keys.widgets, widget.key);
  }
  app.stop();
  return keys;
}

test('the version, the image tag and package.json agree', () => {
  assert.equal(manifest.version, packageJson.version);
  assert.equal(manifest.docker_image, `ghcr.io/prohand/gladys-openhasp:${manifest.version}`);
});

test('every manifest action, scene action and widget has a handler', async () => {
  const keys = await registeredKeys();
  assert.deepEqual(
    keys.actions,
    manifest.actions.map((action) => action.key),
  );
  assert.deepEqual(
    keys.sceneActions,
    manifest.scene_actions.map((action) => action.key),
  );
  assert.deepEqual(keys.widgets, [PLATES_WIDGET]);
});

test('the code and the manifest name the same keys', () => {
  assert.deepEqual(
    manifest.actions.map((action) => action.key).sort(),
    Object.values(ACTIONS).sort(),
  );
  assert.deepEqual(
    manifest.scene_actions.map((action) => action.key).sort(),
    Object.values(SCENE_ACTIONS).sort(),
  );
  assert.deepEqual(Object.keys(SCENE_ACTION_HANDLERS).sort(), Object.values(SCENE_ACTIONS).sort());
  assert.deepEqual(
    manifest.scene_triggers.map((trigger) => trigger.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
  assert.deepEqual(
    manifest.widgets.map((widget) => widget.key),
    [PLATES_WIDGET],
  );
});

test('the trigger filters offer exactly what the code fires', () => {
  const options = (triggerKey, fieldKey) =>
    manifest.scene_triggers
      .find((trigger) => trigger.key === triggerKey)
      .fields.find((field) => field.key === fieldKey)
      .options.map((option) => option.value);
  assert.deepEqual(options(SCENE_TRIGGERS.OBJECT_EVENT, 'event'), TRIGGER_EVENTS);
  assert.deepEqual(options(SCENE_TRIGGERS.PLATE_STATUS, 'status'), PLATE_STATUSES);
  const typeOptions = manifest.actions
    .find((action) => action.key === ACTIONS.ADD_OBJECT)
    .fields.find((field) => field.key === 'type')
    .options.map((option) => option.value);
  assert.deepEqual(typeOptions, Object.values(OBJECT_TYPES));
});

test('every scene action answers the `sent` output it declares', () => {
  for (const action of manifest.scene_actions) {
    assert.deepEqual(
      action.outputs.map((output) => [output.key, output.type]),
      [['sent', 'boolean']],
      action.key,
    );
  }
});

// The store schema is the admission authority: a field type outside this list,
// or a placeholder that is not a multi-language object, gets the integration
// rejected by the indexer.
const FIELD_TYPES = [
  'string',
  'number',
  'boolean',
  'select',
  'multi_select',
  'secret',
  'oauth2',
  'section',
];

test('every field uses a type the store accepts', () => {
  const allFields = [
    ...manifest.config_schema,
    ...manifest.actions.flatMap((a) => a.fields ?? []),
    ...manifest.widgets.flatMap((w) => w.settings ?? []),
    ...manifest.scene_triggers.flatMap((t) => t.fields ?? []),
    ...manifest.scene_actions.flatMap((a) => a.fields ?? []),
  ];
  for (const field of allFields) {
    assert.ok(FIELD_TYPES.includes(field.type), `field "${field.key}": type "${field.type}"`);
    assert.match(field.key, /^[a-z0-9_]+$/, `field key "${field.key}" must be snake_case`);
    if (field.placeholder !== undefined) {
      assert.equal(typeof field.placeholder, 'object', `field "${field.key}": placeholder`);
      assert.ok(['string', 'number', 'secret'].includes(field.type), `field "${field.key}"`);
    }
    if (field.min !== undefined || field.max !== undefined) {
      assert.equal(field.type, 'number', `field "${field.key}": min/max are number-only`);
    }
    if (field.source !== undefined) {
      assert.equal(field.source, 'devices');
      assert.equal(field.options, undefined, `field "${field.key}": source and options`);
      assert.equal(field.default, undefined, `field "${field.key}": source and default`);
    }
  }
  // A scene trigger filter is never a boolean (it could not say "any").
  for (const field of manifest.scene_triggers.flatMap((t) => t.fields ?? [])) {
    assert.notEqual(field.type, 'boolean');
  }
  // A secret never goes into a scene: every user can read a scene.
  for (const field of manifest.scene_actions.flatMap((a) => a.fields ?? [])) {
    assert.notEqual(field.type, 'secret');
  }
});

test('the catalog name and description fit what the store allows', () => {
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  for (const [language, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${language} must be 10-100 characters, got ${text.length}`,
    );
  }
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'section') {
      assert.ok(!(field.key in DEFAULT_CONFIG), `section "${field.key}" stores no value`);
      assert.equal(field.required, undefined);
      assert.equal(field.default, undefined);
      for (const link of field.links ?? []) {
        assert.match(link.url, /^https:\/\//, 'section links must be https');
      }
      continue;
    }
    assert.ok(field.key in DEFAULT_CONFIG, `config key "${field.key}" missing in DEFAULT_CONFIG`);
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `DEFAULT_CONFIG.${field.key}`);
    }
  }
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    assert.ok(
      manifest.config_schema.some((field) => field.key === key),
      `DEFAULT_CONFIG.${key} is not in the manifest`,
    );
  }
});

test('the MQTT password is a secret field, never a plain one', () => {
  const field = manifest.config_schema.find((entry) => entry.key === 'mqtt_password');
  assert.equal(field.type, 'secret');
  assert.equal(field.default, undefined);
});

// The vocabulary the store indexes. An unknown one is not an error the
// indexer raises: it is dropped, and the integration quietly stops appearing
// under the category it meant to be in.
const CATEGORIES = [
  'climate',
  'lighting',
  'energy',
  'security',
  'multimedia',
  'appliances',
  'environment',
  'protocols',
  'network',
  'notifications',
  'assistants',
  'services',
  'transport',
  'vehicles',
  'servers',
  'leisure',
];

test('the categories stay inside the vocabulary the store indexes', () => {
  const { categories } = manifest;
  assert.ok(categories.length >= 1 && categories.length <= 3);
  assert.equal(new Set(categories).size, categories.length);
  for (const category of categories) {
    assert.ok(CATEGORIES.includes(category), `unknown category "${category}"`);
  }
});

/** Whether the minimum of `gladys_version` is at least major.minor. */
function floorAtLeast(wantedMajor, wantedMinor) {
  const [major, minor] = manifest.gladys_version.replace(/^>=/, '').split('.').map(Number);
  return major > wantedMajor || (major === wantedMajor && minor >= wantedMinor);
}

test('the Gladys floor covers every field the manifest declares', () => {
  // Older cores reject a manifest field they do not know: `categories` needs
  // 4.86, the widgets and scene declarations 5.1, `keywords`, `countries`
  // and `music` 5.3.
  assert.ok(floorAtLeast(5, 1), `got ${manifest.gladys_version}`);
  if (['keywords', 'countries', 'music'].some((field) => field in manifest)) {
    assert.ok(floorAtLeast(5, 3), `keywords/countries need 5.3.0, got ${manifest.gladys_version}`);
  }
});

test('the search keywords follow the store rules', () => {
  const { keywords } = manifest;
  assert.ok(Array.isArray(keywords) && keywords.length >= 1 && keywords.length <= 10);
  const normalized = keywords.map((keyword) => keyword.trim().toLowerCase());
  assert.equal(new Set(normalized).size, keywords.length, 'keywords must be unique');
  for (const keyword of normalized) {
    assert.ok(keyword.length >= 2 && keyword.length <= 30, `keyword "${keyword}"`);
  }
});

test('openHASP works in any country: no countries restriction', () => {
  // Declared, `countries` hides the integration from the catalog of every
  // other country. openHASP is open firmware running anywhere: worldwide.
  assert.equal(manifest.countries, undefined);
});

test('the plates are reached on the local network only', () => {
  // MQTT on the LAN, no cloud: `local` alone (no "prefer local" toggle).
  assert.deepEqual(manifest.transports, ['local']);
});

/** Every multi-language object of the manifest, with where it sits. */
function multiLanguageTexts(node, path = 'manifest') {
  if (Array.isArray(node)) {
    return node.flatMap((child, index) => multiLanguageTexts(child, `${path}[${index}]`));
  }
  if (node === null || typeof node !== 'object') {
    return [];
  }
  const keys = Object.keys(node);
  if (keys.includes('en') && keys.every((key) => /^[a-z]{2}$/.test(key))) {
    return [{ path, text: node }];
  }
  return keys.flatMap((key) => multiLanguageTexts(node[key], `${path}.${key}`));
}

test('every multi-language text of the manifest carries en, fr, de and es', () => {
  // Gladys shows the reader's language and falls back to English: a text
  // missing one of them shows up in English in the middle of a translated
  // screen. The store accepts any two-letter key, so nothing else catches it.
  const texts = multiLanguageTexts(manifest);
  assert.ok(texts.length > 50, `only ${texts.length} texts found`);
  for (const { path, text } of texts) {
    assert.deepEqual(Object.keys(text).sort(), [...LANGUAGES].sort(), `${path}: languages`);
    for (const language of LANGUAGES) {
      assert.ok(text[language].trim().length > 0, `${path}.${language} is empty`);
    }
  }
});

test('the per-language length limits of the store hold in every language', () => {
  const within = (text, min, max, where) => {
    for (const language of LANGUAGES) {
      const { length } = text[language];
      assert.ok(length >= min && length <= max, `${where}.${language}: ${length} characters`);
    }
  };
  within(manifest.description, 10, 100, 'description');
  for (const widget of manifest.widgets) {
    within(widget.label, 3, 30, `widget ${widget.key} label`);
    within(widget.description, 1, 100, `widget ${widget.key} description`);
  }
  for (const section of manifest.config_schema.filter((field) => field.type === 'section')) {
    within(section.description, 1, 1000, `section ${section.key} description`);
  }
  for (const capability of [...manifest.scene_triggers, ...manifest.scene_actions]) {
    assert.ok(capability.key.length <= 40, capability.key);
  }
});

test('the documentation exists in the four languages', async () => {
  for (const language of LANGUAGES) {
    const text = await readFile(new URL(`../docs/${language}.md`, import.meta.url), 'utf8');
    assert.ok(text.length > 1000, `docs/${language}.md is too short`);
    for (const key of [...Object.values(SCENE_TRIGGERS), ...Object.values(SCENE_ACTIONS)]) {
      assert.ok(text.includes(key), `docs/${language}.md does not mention ${key}`);
    }
  }
});
