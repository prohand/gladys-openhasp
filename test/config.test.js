import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  formatObjects,
  isObjectId,
  isPlateName,
  normalizeConfig,
  normalizeMqttUrl,
  parseObjects,
  redactUrl,
} from '../src/config.js';

test('an empty config is the defaults, without a broker', () => {
  const config = normalizeConfig();
  assert.equal(config.mqtt_url, null);
  assert.equal(config.topic_prefix, DEFAULT_CONFIG.topic_prefix);
  assert.deepEqual(config.objectList, []);
  assert.deepEqual(config.objectErrors, []);
});

test('the broker address gets a scheme when typed bare', () => {
  assert.equal(normalizeMqttUrl('192.168.1.10'), 'mqtt://192.168.1.10');
  assert.equal(normalizeMqttUrl(' 192.168.1.10:1884 '), 'mqtt://192.168.1.10:1884');
  assert.equal(normalizeMqttUrl('mqtts://broker.lan:8883'), 'mqtts://broker.lan:8883');
  assert.equal(normalizeMqttUrl('ws://broker.lan:9001'), 'ws://broker.lan:9001');
  assert.equal(normalizeMqttUrl('http://broker.lan'), null);
  assert.equal(normalizeMqttUrl(''), null);
  assert.equal(normalizeMqttUrl(undefined), null);
});

test('credentials typed in the URL never show in what is logged', () => {
  assert.equal(redactUrl('mqtt://bob:s3cret@broker.lan:1883'), 'mqtt://***@broker.lan:1883');
  assert.equal(redactUrl('mqtt://broker.lan:1883'), 'mqtt://broker.lan:1883');
  assert.equal(redactUrl(null), '');
});

test('the topic prefix is one clean topic level', () => {
  assert.equal(normalizeConfig({ topic_prefix: '/myhasp/' }).topic_prefix, 'myhasp');
  assert.equal(normalizeConfig({ topic_prefix: 'hasp/#' }).topic_prefix, 'hasp');
  assert.equal(normalizeConfig({ topic_prefix: '' }).topic_prefix, 'hasp');
});

test('plate names and object ids follow openHASP', () => {
  assert.ok(isPlateName('plate01'));
  assert.ok(isPlateName('salon-entree_2'));
  assert.ok(!isPlateName('plate 01'));
  assert.ok(!isPlateName('plate/01'));
  assert.ok(isObjectId('p1b2'));
  assert.ok(isObjectId('p0b1'));
  assert.ok(isObjectId('p12b254'));
  assert.ok(!isObjectId('p13b1'));
  assert.ok(!isObjectId('p1b255'));
  assert.ok(!isObjectId('b2'));
});

test('the objects setting is read entry by entry, a typo skips one entry only', () => {
  const { objects, errors } = parseObjects(
    'plate01.p1b2:switch:Living room light, plate01.P1B3:Button ; bad entry;\nplate02.p2b1:text:Time: now,plate01.p1b2:slider,plate01.p1b9:gauge',
  );
  assert.deepEqual(objects, [
    { plate: 'plate01', object: 'p1b2', type: 'switch', name: 'Living room light' },
    { plate: 'plate01', object: 'p1b3', type: 'button', name: 'plate01 p1b3' },
    { plate: 'plate02', object: 'p2b1', type: 'text', name: 'Time: now' },
  ]);
  assert.equal(errors.length, 3);
  assert.match(errors[0], /bad entry/);
  assert.match(errors[1], /already declared/);
  assert.match(errors[2], /unknown type "gauge"/);
});

test('the objects setting written back reads the same', () => {
  const objects = [
    { plate: 'plate01', object: 'p1b2', type: 'switch', name: 'Lamp, kitchen; left' },
    { plate: 'plate02', object: 'p2b1', type: 'text', name: '' },
  ];
  const text = formatObjects(objects);
  assert.equal(text, 'plate01.p1b2:switch:Lamp kitchen left, plate02.p2b1:text');
  assert.deepEqual(parseObjects(text).objects, [
    { plate: 'plate01', object: 'p1b2', type: 'switch', name: 'Lamp kitchen left' },
    { plate: 'plate02', object: 'p2b1', type: 'text', name: 'plate02 p2b1' },
  ]);
});
