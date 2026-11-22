// -----------------------------------------------------------------------------
// The openHASP side: topics, payloads, and the hub that follows the plates.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { topicsFor } from '../src/openhasp/topics.js';
import {
  parseBacklight,
  parseBoolean,
  parseIdle,
  parseObjectEvent,
  parsePage,
  parsePlateInfo,
  signalQuality,
} from '../src/openhasp/payloads.js';
import { Broker } from '../src/openhasp/broker.js';
import { Hub } from '../src/openhasp/hub.js';
import { normalizeConfig } from '../src/config.js';
import { createFakeMqtt, settle } from './helpers/fakeMqtt.js';

test('topics: what the integration listens to and where it sends', () => {
  const topics = topicsFor('hasp');
  assert.deepEqual(topics.subscriptions, ['hasp/+/LWT', 'hasp/+/state/#', 'hasp/discovery/#']);
  assert.equal(topics.command('plate01', 'page'), 'hasp/plate01/command/page');
  assert.equal(topics.command('plate01'), 'hasp/plate01/command');
  assert.equal(topics.broadcast('discovery'), 'hasp/broadcast/command/discovery');
});

test('topics: received topics are sorted out, foreign ones ignored', () => {
  const topics = topicsFor('hasp');
  assert.deepEqual(topics.parse('hasp/plate01/LWT'), { kind: 'lwt', plate: 'plate01' });
  assert.deepEqual(topics.parse('hasp/plate01/state/p1b2'), {
    kind: 'state',
    plate: 'plate01',
    key: 'p1b2',
  });
  assert.deepEqual(topics.parse('hasp/discovery/aabbcc'), { kind: 'discovery', id: 'aabbcc' });
  assert.equal(topics.parse('hasp/plates/state/page'), null);
  assert.equal(topics.parse('hasp/broadcast/command/page'), null);
  assert.equal(topics.parse('hasp/plate01/command/page'), null);
  assert.equal(topics.parse('zigbee2mqtt/lamp'), null);
});

test('payloads: the spellings of every firmware are understood', () => {
  for (const word of ['on', 'ON', 'true', '1', 'yes', 'online']) {
    assert.equal(parseBoolean(word), true, word);
  }
  for (const word of ['off', 'OFF', 'false', '0', 'no', 'offline']) {
    assert.equal(parseBoolean(word), false, word);
  }
  assert.equal(parseBoolean('maybe'), null);
  assert.deepEqual(parseBacklight('{"state":"ON","brightness":128}'), {
    on: true,
    brightness: 128,
  });
  assert.deepEqual(parseBacklight('off'), { on: false, brightness: null });
  assert.equal(parseBacklight('garbage'), null);
  assert.equal(parseIdle('LONG'), 'long');
  assert.equal(parseIdle('sleepy'), null);
  assert.equal(parsePage('3'), 3);
  assert.equal(parsePage('13'), null);
  assert.equal(parsePage('next'), null);
});

test('payloads: discovery (0.7) and statusupdate (0.6) describe the same plate', () => {
  const discovery = parsePlateInfo(
    '{"node":"plate01","mdl":"Lanbon L8","hwid":"aabbcc","sw":"0.7.0","pages":5,"uri":"http://192.168.1.50"}',
  );
  assert.equal(discovery.node, 'plate01');
  assert.equal(discovery.model, 'Lanbon L8');
  assert.equal(discovery.version, '0.7.0');
  assert.equal(discovery.pages, 5);
  assert.equal(discovery.ip, '192.168.1.50');
  const status = parsePlateInfo(
    '{"node":"plate01","idle":"long","version":"0.6.3","rssi":-60,"ip":"192.168.0.133","page":1,"numPages":12}',
  );
  assert.equal(status.version, '0.6.3');
  assert.equal(status.pages, 12);
  assert.equal(status.rssi, -60);
  assert.equal(status.idle, 'long');
  assert.equal(parsePlateInfo('not json'), null);
});

test('payloads: object events, and the WiFi quality in bars', () => {
  assert.deepEqual(parseObjectEvent('{"event":"up","val":1}'), { event: 'up', val: 1, text: null });
  assert.deepEqual(parseObjectEvent('{"event":"changed","val":2,"text":"Two"}'), {
    event: 'changed',
    val: 2,
    text: 'Two',
  });
  assert.equal(parseObjectEvent('{"event":"wobble"}'), null);
  assert.equal(signalQuality(-50), 5);
  assert.equal(signalQuality(-70), 3);
  assert.equal(signalQuality(-95), 0);
  assert.equal(signalQuality(null), null);
});

async function startHub(overrides = {}) {
  const mqtt = createFakeMqtt();
  const broker = new Broker({ connect: mqtt.connect });
  const sleeps = [];
  const hub = new Hub({ broker, sleep: async (ms) => sleeps.push(ms) });
  hub.start(normalizeConfig({ mqtt_url: 'mqtt://broker.lan', ...overrides }));
  await mqtt.accept();
  return { mqtt, broker, hub, sleeps };
}

test('broker: connects with the credentials and a client id of its own', async () => {
  const { mqtt, broker } = await startHub({ mqtt_username: 'gladys', mqtt_password: 'pw' });
  assert.equal(mqtt.client.url, 'mqtt://broker.lan');
  assert.equal(mqtt.client.options.username, 'gladys');
  assert.equal(mqtt.client.options.password, 'pw');
  assert.match(mqtt.client.options.clientId, /^gladys-openhasp-[0-9a-f]{8}$/);
  assert.ok(broker.connected);
  broker.stop();
  assert.ok(mqtt.client.ended);
  assert.equal(broker.connected, false);
});

test('broker: an order while disconnected fails right away', async () => {
  const mqtt = createFakeMqtt();
  const broker = new Broker({ connect: mqtt.connect });
  await assert.rejects(broker.publish('hasp/plate01/command/page', '1'), /Not connected/);
  assert.equal(await broker.waitConnected(10), false);
});

test('hub: a plate is found by its LWT, followed, and asked what it shows', async () => {
  const { mqtt, hub } = await startHub();
  const events = [];
  for (const name of ['plate-added', 'plate-online', 'plate-updated', 'page-changed']) {
    hub.on(name, (...args) => events.push([name, ...args.slice(1)]));
  }
  mqtt.clear();
  mqtt.receive('hasp/plate01/LWT', 'online');
  await settle();
  assert.deepEqual(events.slice(0, 2), [['plate-added'], ['plate-online', null]]);
  assert.deepEqual(
    mqtt.published.map((m) => m.topic),
    [
      'hasp/plate01/command/statusupdate',
      'hasp/plate01/command/backlight',
      'hasp/plate01/command/page',
      'hasp/plate01/command/idle',
    ],
  );

  mqtt.receive('hasp/plate01/state/page', '1');
  mqtt.receive('hasp/plate01/state/page', '1');
  mqtt.receive('hasp/plate01/state/page', '2');
  mqtt.receive('hasp/plate01/state/backlight', '{"state":"on","brightness":200}');
  mqtt.receive('hasp/plate01/state/idle', 'short');
  mqtt.receive(
    'hasp/plate01/state/statusupdate',
    '{"node":"plate01","rssi":-61,"ip":"192.168.1.50","version":"0.7.0"}',
  );
  const plate = hub.get('plate01');
  assert.equal(plate.online, true);
  assert.equal(plate.page, 2);
  assert.equal(plate.backlight, true);
  assert.equal(plate.brightness, 200);
  assert.equal(plate.idle, 'short');
  assert.equal(plate.rssi, -61);
  assert.equal(plate.ip, '192.168.1.50');
  // The first page known is a reading; only 1 -> 2 is a change.
  assert.deepEqual(
    events.filter(([name]) => name === 'page-changed'),
    [['page-changed', 2, 1]],
  );

  mqtt.receive('hasp/plate01/LWT', 'offline');
  assert.equal(plate.online, false);
  assert.deepEqual(events.at(-1), ['plate-online', true]);
});

test('hub: a discovery tells the pages, a strange message changes nothing', async () => {
  const { mqtt, hub } = await startHub();
  const infos = [];
  hub.on('plate-info', (plate) => infos.push(plate.pages));
  mqtt.receive('hasp/discovery/aabbcc', '{"node":"plate02","mdl":"WT32-SC01","pages":6}');
  mqtt.receive('hasp/discovery/aabbcc', '{"node":"plate02","mdl":"WT32-SC01","pages":6}');
  mqtt.receive('hasp/discovery/ddeeff', '{"node":"bad name!"}');
  mqtt.receive('hasp/plate02/state/p1b2', 'not json');
  mqtt.receive('hasp/plate02/state/backlight', 'garbage');
  assert.deepEqual(infos, [6]);
  assert.deepEqual(
    hub.list().map((plate) => [plate.name, plate.model, plate.online]),
    [['plate02', 'WT32-SC01', true]],
  );
});

test('hub: object events are passed on and remembered', async () => {
  const { mqtt, hub } = await startHub();
  const touched = [];
  hub.on('object-event', (plate, object, event) => touched.push([plate.name, object, event.event]));
  mqtt.receive('hasp/plate01/state/p1b2', '{"event":"down"}');
  mqtt.receive('hasp/plate01/state/p1b2', '{"event":"up"}');
  mqtt.receive('hasp/plate01/state/p3b10', '{"event":"changed","val":40}');
  assert.deepEqual(touched, [
    ['plate01', 'p1b2', 'down'],
    ['plate01', 'p1b2', 'up'],
    ['plate01', 'p3b10', 'changed'],
  ]);
  assert.deepEqual([...hub.get('plate01').objectsHeard.keys()], ['p1b2', 'p3b10']);
});

test('hub: the orders are the openHASP commands', async () => {
  const { mqtt, hub, sleeps } = await startHub();
  mqtt.receive('hasp/plate01/state/backlight', '{"state":"on","brightness":150}');
  await settle(); // the state request a new plate gets
  mqtt.clear();
  await hub.showPage('plate01', 3);
  await hub.setBacklight('plate01', { on: true, brightness: 300 });
  await hub.setIdle('plate01', 'off');
  await hub.setObjectProperty('plate01', 'p1b2', 'text', 'Hello');
  await hub.sendRaw('plate01', 'p1b2.bg_color=red');
  await hub.discover();
  assert.deepEqual(mqtt.published, [
    { topic: 'hasp/plate01/command/page', payload: '3' },
    { topic: 'hasp/plate01/command/backlight', payload: '{"state":"on","brightness":255}' },
    { topic: 'hasp/plate01/command/idle', payload: 'off' },
    { topic: 'hasp/plate01/command/p1b2.text', payload: 'Hello' },
    { topic: 'hasp/plate01/command', payload: 'p1b2.bg_color=red' },
    { topic: 'hasp/broadcast/command/discovery', payload: '' },
    { topic: 'hasp/broadcast/command/statusupdate', payload: '' },
  ]);
  await assert.rejects(hub.showPage('plate01', 13), /Invalid page/);
  await assert.rejects(hub.setObjectProperty('plate01', 'button1', 'text', 'x'), /Invalid object/);
  await assert.rejects(hub.sendRaw('plate01', '  '), /Empty command/);
  await assert.rejects(hub.command('plate/01', 'page', '1'), /Invalid plate/);

  mqtt.clear();
  await hub.identify('plate01');
  assert.equal(mqtt.published[0].payload, 'off');
  assert.equal(mqtt.on('hasp/plate01/command/backlight').length, 6);
  assert.equal(mqtt.on('hasp/plate01/command/backlight').at(-1), '{"state":"on","brightness":150}');
  assert.deepEqual(sleeps, [400, 400, 400, 400, 400, 400]);
});

test('hub: another prefix forgets the plates of the old one', async () => {
  const { mqtt, hub } = await startHub();
  mqtt.receive('hasp/plate01/LWT', 'online');
  hub.start(normalizeConfig({ mqtt_url: 'mqtt://broker.lan', topic_prefix: 'screens' }));
  await mqtt.accept();
  assert.deepEqual(hub.list(), []);
  assert.deepEqual(mqtt.client.subscriptions, [
    'screens/+/LWT',
    'screens/+/state/#',
    'screens/discovery/#',
  ]);
});
