// -----------------------------------------------------------------------------
// The whole integration, against the SDK's fake Gladys and a fake broker.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createApp } from '../src/app.js';
import { createFakeMqtt, settle } from './helpers/fakeMqtt.js';

const OBJECTS =
  'plate01.p1b2:switch:Living room light, plate01.p1b3:button:Good night, plate01.p1b4:slider:Volume, plate01.p2b1:text:Message';

const ID = {
  plate: 'ext:test-integration:plate:plate01',
  feature: (key) => `ext:test-integration:plate:plate01:${key}`,
  object: (address, key) => `ext:test-integration:object:plate01.${address}:${key}`,
};

/** A running integration with plate01 online, page 1, backlight on at 255. */
async function start(t, { waits, ...config } = {}) {
  const mqtt = createFakeMqtt();
  const gladys = createFakeGladys({
    config: { mqtt_url: 'mqtt://broker.lan', objects: OBJECTS, ...config },
  });
  const sleeps = [];
  const app = createApp(gladys, {
    connect: mqtt.connect,
    sleep: async (ms) => sleeps.push(ms),
    debounceMs: 5,
    waits,
  });
  t.after(() => app.stop());
  await gladys.connect();
  if (gladys.fake.config.mqtt_url && !waits) {
    await mqtt.accept();
  }
  return { mqtt, gladys, app, sleeps };
}

async function plateOnline({ mqtt, app }) {
  mqtt.receive('hasp/plate01/LWT', 'online');
  mqtt.receive(
    'hasp/discovery/aabbccddeeff',
    '{"node":"plate01","mdl":"Lanbon L8","hwid":"aabbccddeeff","sw":"0.7.0","pages":4}',
  );
  mqtt.receive('hasp/plate01/state/page', '1');
  mqtt.receive('hasp/plate01/state/backlight', '{"state":"on","brightness":255}');
  mqtt.receive('hasp/plate01/state/idle', 'off');
  mqtt.receive('hasp/plate01/state/statusupdate', '{"node":"plate01","rssi":-58}');
  await app.flush();
  await settle();
}

const device = (gladys, externalId) =>
  gladys.fake.discoveredDevices.find((entry) => entry.external_id === externalId);

test('without a broker address, the Configuration screen says what to fill in', async (t) => {
  const { gladys, mqtt } = await start(t, { mqtt_url: '' });
  assert.equal(mqtt.clients.length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /MQTT broker/);
  assert.match(gladys.fake.connectionStatus.message.de, /MQTT-Brokers/);
});

test('connected: listens to the plates, asks them to introduce themselves, says it is up', async (t) => {
  const { gladys, mqtt } = await start(t);
  await settle();
  assert.deepEqual(mqtt.client.subscriptions, ['hasp/+/LWT', 'hasp/+/state/#', 'hasp/discovery/#']);
  assert.deepEqual(mqtt.on('hasp/broadcast/command/discovery'), ['']);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('the declared objects and the plates seen are the devices of the Discovery screen', async (t) => {
  const context = await start(t);
  const { gladys } = context;
  // Before the plate shows up, its objects already name it.
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((entry) => entry.external_id),
    [
      ID.plate,
      'ext:test-integration:object:plate01.p1b2',
      'ext:test-integration:object:plate01.p1b3',
      'ext:test-integration:object:plate01.p1b4',
      'ext:test-integration:object:plate01.p2b1',
    ],
  );
  await plateOnline(context);
  const plate = device(gladys, ID.plate);
  assert.equal(plate.name, 'openHASP plate01');
  assert.equal(plate.model, 'Lanbon L8');
  assert.deepEqual(
    plate.features.map((feature) => [feature.external_id, feature.category, feature.type]),
    [
      [ID.feature('backlight'), 'light', 'binary'],
      [ID.feature('brightness'), 'light', 'brightness'],
      [ID.feature('page'), 'text', 'select'],
      [ID.feature('awake'), 'switch', 'binary'],
      [ID.feature('signal'), 'signal', 'integer'],
    ],
  );
  // The pages come from the discovery: 4 here, not the 12 of the default.
  const page = plate.features.find((feature) => feature.external_id === ID.feature('page'));
  assert.deepEqual(
    page.supported_options.map((option) => option.value),
    ['1', '2', '3', '4'],
  );
  assert.deepEqual(
    gladys.fake.discoveredDevices.slice(1).map((entry) => {
      const [feature] = entry.features;
      return [entry.name, feature.category, feature.type, feature.read_only];
    }),
    [
      ['Living room light', 'switch', 'binary', false],
      ['Good night', 'button', 'click', true],
      ['Volume', 'switch', 'dimmer', false],
      ['Message', 'text', 'text', false],
    ],
  );
});

test('every feature carries the columns Gladys stores NOT NULL', async (t) => {
  const context = await start(t);
  await plateOnline(context);
  for (const entry of context.gladys.fake.discoveredDevices) {
    for (const feature of entry.features) {
      for (const column of ['name', 'min', 'max', 'read_only', 'has_feedback']) {
        assert.notEqual(feature[column], undefined, `${feature.external_id}.${column}`);
      }
    }
  }
});

test('what a plate shows becomes the states of its features', async (t) => {
  const context = await start(t);
  await plateOnline(context);
  const { gladys, mqtt } = context;
  assert.equal(gladys.fake.lastState(ID.feature('backlight')), 1);
  assert.equal(gladys.fake.lastState(ID.feature('brightness')), 100);
  assert.equal(gladys.fake.lastState(ID.feature('awake')), 1);
  assert.equal(gladys.fake.lastState(ID.feature('signal')), 4);
  const pageState = () =>
    gladys.fake.states.filter((s) => s.device_feature_external_id === ID.feature('page')).at(-1);
  assert.equal(pageState().text, '1');

  mqtt.receive('hasp/plate01/state/idle', 'long');
  mqtt.receive('hasp/plate01/state/backlight', '{"state":"on","brightness":51}');
  mqtt.receive('hasp/plate01/state/page', '3');
  await settle();
  assert.equal(gladys.fake.lastState(ID.feature('awake')), 0);
  assert.equal(gladys.fake.lastState(ID.feature('brightness')), 20);
  assert.equal(pageState().text, '3');
});

test('a plate going online or offline moves its badge and fires the trigger', async (t) => {
  const context = await start(t);
  await plateOnline(context);
  const { gladys, mqtt } = context;
  const badge = (id) => gladys.fake.transports.filter((e) => e.device_external_id === id).at(-1);
  assert.equal(badge(ID.plate).transport, 'local');
  assert.equal(badge('ext:test-integration:object:plate01.p1b2').transport, 'local');
  // Coming online at startup is a reading, not an event.
  assert.deepEqual(
    gladys.fake.sceneEvents.filter((event) => event.key === 'plate_status'),
    [],
  );

  mqtt.receive('hasp/plate01/LWT', 'offline');
  await settle();
  assert.equal(badge(ID.plate).transport, 'unreachable');
  assert.equal(badge('ext:test-integration:object:plate01.p1b2').transport, 'unreachable');
  assert.deepEqual(gladys.fake.sceneEvents.at(-1), {
    key: 'plate_status',
    data: { plate: ID.plate, status: 'offline' },
  });

  mqtt.receive('hasp/plate01/LWT', 'online');
  await settle();
  assert.deepEqual(gladys.fake.sceneEvents.at(-1).data.status, 'online');
});

test('the broker going away makes every device unreachable and says so', async (t) => {
  const context = await start(t);
  await plateOnline(context);
  const { gladys, mqtt } = context;
  mqtt.client.emit('error', new Error('connect ECONNREFUSED 192.168.1.10:1883'));
  mqtt.drop();
  await settle();
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /ECONNREFUSED/);
  assert.equal(gladys.fake.transports.at(-1).transport, 'unreachable');
  await mqtt.accept();
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('touching objects: states for the declared ones, a trigger for all of them', async (t) => {
  const context = await start(t);
  await plateOnline(context);
  const { gladys, mqtt } = context;
  gladys.fake.sceneEvents.length = 0;

  // A toggle: down carries the old value, up the new one.
  mqtt.receive('hasp/plate01/state/p1b2', '{"event":"down","val":0}');
  mqtt.receive('hasp/plate01/state/p1b2', '{"event":"up","val":1}');
  // A slider being dragged: only the final value counts.
  mqtt.receive('hasp/plate01/state/p1b4', '{"event":"down","val":20}');
  mqtt.receive('hasp/plate01/state/p1b4', '{"event":"changed","val":30}');
  mqtt.receive('hasp/plate01/state/p1b4', '{"event":"changed","val":40}');
  mqtt.receive('hasp/plate01/state/p1b4', '{"event":"up","val":45}');
  // A button clicked twice: twice the click, then a long press.
  for (const event of ['down', 'up', 'down', 'up', 'down', 'long', 'hold', 'hold', 'release']) {
    mqtt.receive('hasp/plate01/state/p1b3', JSON.stringify({ event }));
  }
  // An object nobody declared still fires the trigger.
  mqtt.receive('hasp/plate01/state/p4b9', '{"event":"up"}');
  await settle();

  assert.equal(gladys.fake.lastState(ID.object('p1b2', 'state')), 1);
  const levels = gladys.fake.states
    .filter((s) => s.device_feature_external_id === ID.object('p1b4', 'level'))
    .map((s) => s.state);
  assert.deepEqual(levels, [45]);
  const clicks = gladys.fake.states
    .filter((s) => s.device_feature_external_id === ID.object('p1b3', 'click'))
    .map((s) => s.state);
  assert.deepEqual(clicks, [1, 1, 3, 4]);

  const fired = gladys.fake.sceneEvents.map(({ data }) => `${data.object}:${data.event}`);
  // No `changed`, no `hold`: one event per transition.
  assert.deepEqual(fired, [
    'p1b2:down',
    'p1b2:up',
    'p1b4:down',
    'p1b4:up',
    'p1b3:down',
    'p1b3:up',
    'p1b3:down',
    'p1b3:up',
    'p1b3:down',
    'p1b3:long',
    'p1b3:release',
    'p4b9:up',
  ]);
  assert.deepEqual(gladys.fake.sceneEvents[3], {
    key: 'object_event',
    data: { plate: ID.plate, object: 'p1b4', event: 'up', value: 45, text: null },
  });
});

test('a page change fires page_changed', async (t) => {
  const context = await start(t);
  await plateOnline(context);
  context.mqtt.receive('hasp/plate01/state/page', '2');
  await settle();
  assert.deepEqual(context.gladys.fake.sceneEvents.at(-1), {
    key: 'page_changed',
    data: { plate: ID.plate, page: 2 },
  });
});

test('Gladys commands become openHASP commands, and their state follows', async (t) => {
  const context = await start(t);
  await plateOnline(context);
  const { gladys, mqtt } = context;
  mqtt.clear();
  const set = async (deviceId, featureId, value) => {
    const entry = device(gladys, deviceId);
    const feature = entry.features.find((f) => f.external_id === featureId);
    return gladys.fake.setValue(entry, feature, value);
  };

  assert.deepEqual(await set(ID.plate, ID.feature('page'), '3'), { success: true });
  await set(ID.plate, ID.feature('backlight'), 0);
  await set(ID.plate, ID.feature('brightness'), 50);
  await set(ID.plate, ID.feature('brightness'), 0);
  await set(ID.plate, ID.feature('awake'), 1);
  await set(ID.plate, ID.feature('awake'), 0);
  const objectId = (address) => `ext:test-integration:object:plate01.${address}`;
  await set(objectId('p1b2'), ID.object('p1b2', 'state'), 0);
  await set(objectId('p1b4'), ID.object('p1b4', 'level'), 72.4);
  await set(objectId('p2b1'), ID.object('p2b1', 'text'), 'Dinner is ready');

  assert.deepEqual(mqtt.published, [
    { topic: 'hasp/plate01/command/page', payload: '3' },
    { topic: 'hasp/plate01/command/backlight', payload: '{"state":"off"}' },
    { topic: 'hasp/plate01/command/backlight', payload: '{"state":"on","brightness":128}' },
    { topic: 'hasp/plate01/command/backlight', payload: '{"state":"off"}' },
    { topic: 'hasp/plate01/command/idle', payload: 'off' },
    { topic: 'hasp/plate01/command/idle', payload: 'long' },
    { topic: 'hasp/plate01/command/p1b2.val', payload: '0' },
    { topic: 'hasp/plate01/command/p1b4.val', payload: '72' },
    { topic: 'hasp/plate01/command/p2b1.text', payload: 'Dinner is ready' },
  ]);
  assert.equal(gladys.fake.lastState(ID.object('p1b4', 'level')), 72);
  assert.equal(
    gladys.fake.states
      .filter((s) => s.device_feature_external_id === ID.object('p2b1', 'text'))
      .at(-1).text,
    'Dinner is ready',
  );

  // The signal is read-only, a button cannot be pressed from Gladys.
  assert.equal((await set(ID.plate, ID.feature('signal'), 3)).success, false);
  assert.equal((await set(objectId('p1b3'), ID.object('p1b3', 'click'), 1)).success, false);
  // An order that cannot leave fails, it is not queued.
  mqtt.drop();
  assert.equal((await set(ID.plate, ID.feature('page'), '2')).success, false);
});

test('scene actions answer `sent`, false when the plate cannot receive', async (t) => {
  const context = await start(t);
  await plateOnline(context);
  const { gladys, mqtt } = context;
  mqtt.clear();
  const run = (key, fields) => gladys.fake.sceneAction(key, fields);

  assert.deepEqual(await run('show_page', { plate: ID.plate, page: 2 }), {
    success: true,
    data: { outputs: { sent: true } },
  });
  // A screen object picked in the select means its plate.
  await run('set_object_text', {
    plate: 'ext:test-integration:object:plate01.p2b1',
    object: 'P1B5',
    text: '21.5 °C',
  });
  await run('set_backlight', { plate: ID.plate, state: 'on', brightness: 80 });
  await run('set_backlight', { plate: ID.plate, state: 'off' });
  await run('wake_screen', { plate: ID.plate });
  await run('send_command', { plate: ID.plate, command: 'moodlight {"state":"on","color":"red"}' });
  assert.deepEqual(mqtt.published, [
    { topic: 'hasp/plate01/command/page', payload: '2' },
    { topic: 'hasp/plate01/command/p1b5.text', payload: '21.5 °C' },
    { topic: 'hasp/plate01/command/backlight', payload: '{"state":"on","brightness":80}' },
    { topic: 'hasp/plate01/command/backlight', payload: '{"state":"off"}' },
    { topic: 'hasp/plate01/command/idle', payload: 'off' },
    { topic: 'hasp/plate01/command', payload: 'moodlight {"state":"on","color":"red"}' },
  ]);

  const failed = await run('set_object_text', { plate: ID.plate, object: 'title', text: 'x' });
  assert.equal(failed.success, false);
  assert.match(failed.error, /Invalid object/);

  mqtt.receive('hasp/plate01/LWT', 'offline');
  assert.deepEqual(await run('wake_screen', { plate: ID.plate }), {
    success: true,
    data: { outputs: { sent: false } },
  });
});

test('the widget lists the plates and fits the content rules', async (t) => {
  const context = await start(t);
  const { gladys, mqtt } = context;
  const empty = await gladys.fake.widgetGet('plates', {});
  assert.deepEqual(validateWidgetContent(empty.data.content), []);
  assert.equal(empty.data.content.components[0].type, 'text');

  await plateOnline(context);
  mqtt.receive('hasp/plate02/LWT', 'offline');
  const { data } = await gladys.fake.widgetGet('plates', {});
  assert.deepEqual(validateWidgetContent(data.content), []);
  const tile = data.content.components.find((component) => component.type === 'value');
  assert.equal(tile.value, '1/2');
  const status = data.content.components.find((component) => component.type === 'status');
  assert.deepEqual(
    status.items.map((item) => [item.label, item.value.en, item.color]),
    [
      ['plate01', 'Online, page 1', 'success'],
      ['plate02', 'Offline', 'danger'],
    ],
  );
  assert.ok(gladys.fake.widgetRefreshes.length > 0);
});

test('the widget buttons wake the screens and look for plates', async (t) => {
  const context = await start(t);
  await plateOnline(context);
  const { gladys, mqtt } = context;
  mqtt.receive('hasp/plate02/LWT', 'offline');
  await settle();
  mqtt.clear();
  const woken = await gladys.fake.widgetAction('plates', 'wake_all', {}, { settings: {} });
  assert.equal(woken.success, true);
  assert.match(woken.data.message.fr, /1 écran/);
  assert.deepEqual(mqtt.published, [{ topic: 'hasp/plate01/command/idle', payload: 'off' }]);

  mqtt.clear();
  await gladys.fake.widgetAction('plates', 'discover', {}, { settings: {} });
  assert.deepEqual(mqtt.on('hasp/broadcast/command/discovery'), ['']);
  const unknown = await gladys.fake.widgetAction('plates', 'explode', {}, { settings: {} });
  assert.equal(unknown.success, false);
});

test('Configuration actions: test, search, identify', async (t) => {
  const context = await start(t);
  await plateOnline(context);
  const { gladys, mqtt, sleeps } = context;

  const tested = gladys.fake.action('test_connection', {});
  await settle();
  await mqtt.accept();
  const result = await tested;
  assert.equal(result.success, true);
  assert.match(result.data.message.en, /Connected to mqtt:\/\/broker\.lan/);
  assert.match(result.data.message.en, /Plates online: 1 \(plate01\)/);

  const found = await gladys.fake.action('discover_plates', {});
  assert.match(found.data.message.es, /Pantallas en línea: 1/);

  mqtt.clear();
  sleeps.length = 0;
  const identified = await gladys.fake.action('identify', { device: ID.plate });
  assert.match(identified.data.message.de, /dreimal/);
  assert.equal(mqtt.on('hasp/plate01/command/backlight').length, 6);
});

test('Configuration actions: a broker that does not answer is reported', async (t) => {
  const context = await start(t, {
    mqtt_url: 'mqtt://gladys:secret@nowhere.lan',
    waits: { BROKER: 5, PLATES: 0 },
  });
  const { gladys, mqtt } = context;
  const tested = gladys.fake.action('test_connection', {});
  // The new connection never answers: only an error.
  mqtt.client.emit('error', new Error('getaddrinfo ENOTFOUND nowhere.lan'));
  const result = await tested;
  assert.equal(result.success, true);
  assert.match(
    result.data.message.en,
    /Cannot reach the broker mqtt:\/\/\*\*\*@nowhere\.lan: getaddrinfo ENOTFOUND/,
  );
  assert.doesNotMatch(JSON.stringify(result), /secret/);
  const found = await gladys.fake.action('discover_plates', {});
  assert.match(found.data.message.fr, /Impossible de joindre le broker/);
});

test('Add an object writes the setting and publishes the new device', async (t) => {
  const context = await start(t, { objects: '' });
  await plateOnline(context);
  const { gladys } = context;
  const added = await gladys.fake.action('add_object', {
    plate: ID.plate,
    object: 'P2B7',
    type: 'switch',
    name: 'Fan, bedroom',
  });
  assert.equal(added.success, true);
  assert.equal(gladys.fake.config.objects, 'plate01.p2b7:switch:Fan bedroom');
  assert.ok(device(gladys, 'ext:test-integration:object:plate01.p2b7'));

  // The same object again replaces it instead of declaring it twice.
  await gladys.fake.action('add_object', { plate: ID.plate, object: 'p2b7', type: 'slider' });
  assert.equal(gladys.fake.config.objects, 'plate01.p2b7:slider:plate01 p2b7');

  const bad = await gladys.fake.action('add_object', {
    plate: ID.plate,
    object: 'title',
    type: 'switch',
  });
  assert.equal(bad.success, false);
});

test('List the objects touched shows the ones not declared yet', async (t) => {
  const context = await start(t);
  await plateOnline(context);
  const { gladys, mqtt } = context;
  const none = await gladys.fake.action('list_objects', {});
  assert.match(none.data.message.en, /No new object/);
  mqtt.receive('hasp/plate01/state/p1b2', '{"event":"up","val":1}');
  mqtt.receive('hasp/plate01/state/p3b4', '{"event":"up"}');
  const some = await gladys.fake.action('list_objects', {});
  assert.match(some.data.message.en, /plate01\.p3b4$/);
});

test('a new configuration reconnects only when the connection settings change', async (t) => {
  const context = await start(t);
  const { gladys, mqtt } = context;
  await gladys.fake.configUpdated({ ...gladys.fake.config, objects: 'plate01.p1b2:switch' });
  assert.equal(mqtt.clients.length, 1);
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((entry) => entry.external_id),
    [ID.plate, 'ext:test-integration:object:plate01.p1b2'],
  );
  await gladys.fake.configUpdated({ ...gladys.fake.config, mqtt_url: 'mqtt://other.lan' });
  assert.equal(mqtt.clients.length, 2);
  assert.equal(mqtt.clients[0].ended, true);
  assert.equal(mqtt.client.url, 'mqtt://other.lan');
});

test('a scan asks the plates to introduce themselves, then publishes', async (t) => {
  const context = await start(t);
  const { gladys, mqtt } = context;
  await settle();
  mqtt.clear();
  await gladys.fake.scanRequest();
  assert.deepEqual(mqtt.on('hasp/broadcast/command/discovery'), ['']);
  assert.ok(gladys.fake.discoveredDevices.length > 0);
});

test('stopping closes the MQTT connection', async (t) => {
  const { app, mqtt } = await start(t);
  app.stop();
  assert.equal(mqtt.client.ended, true);
});
