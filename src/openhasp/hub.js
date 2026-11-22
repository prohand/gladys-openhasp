// -----------------------------------------------------------------------------
// The plates: what each one is and shows, and the orders sent to them.
//
// The hub reads every message of the broker and keeps, per plate, the last
// known state (online, page, backlight, idle, WiFi). It knows nothing about
// Gladys: it emits events that src/app.js turns into states, scene events and
// widget refreshes.
//
// Events:
//   'plate-added'   (plate)                  a plate seen for the first time
//   'plate-info'    (plate)                  model / firmware / pages learned
//   'plate-online'  (plate, previous)        online changed (plate.online, previous: null at first)
//   'plate-updated' (plate)                  page, backlight, idle or WiFi changed
//   'page-changed'  (plate, page, previous)  the screen went to another page
//   'object-event'  (plate, object, event)   an object was touched
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createLogger } from '@gladysassistant/integration-sdk';
import { isObjectId, isPlateName } from '../config.js';
import { topicsFor } from './topics.js';
import {
  parseBacklight,
  parseBoolean,
  parseIdle,
  parseObjectEvent,
  parsePage,
  parsePlateInfo,
} from './payloads.js';

const logger = createLogger({ name: 'plates' });

/** Pages an openHASP plate has when it did not say otherwise. */
export const DEFAULT_PAGES = 12;

/** How many distinct objects heard are remembered per plate (for "List the objects"). */
const MAX_OBJECTS_HEARD = 100;

export function newPlate(name) {
  return {
    name,
    online: null,
    hwid: null,
    model: null,
    version: null,
    pages: null,
    ip: null,
    page: null,
    backlight: null,
    brightness: null,
    idle: null,
    rssi: null,
    lastSeen: null,
    // object id -> { event, val, text, at }
    objectsHeard: new Map(),
  };
}

export class Hub extends EventEmitter {
  /**
   * @param {{ broker: import('./broker.js').Broker, sleep?: (ms: number) => Promise<void>, now?: () => number }} options
   */
  constructor({ broker, sleep = (ms) => delay(ms), now = () => Date.now() }) {
    super();
    this.broker = broker;
    this.sleep = sleep;
    this.now = now;
    this.plates = new Map();
    this.topics = topicsFor('hasp');
    broker.on('message', (topic, payload) => this.handleMessage(topic, payload));
  }

  /** (Re)connect to the broker with a configuration. */
  start(config) {
    if (config.topic_prefix !== this.topics.prefix) {
      // Other prefix, other plates: forget the ones of the old prefix.
      this.plates.clear();
      this.topics = topicsFor(config.topic_prefix);
    }
    this.broker.start(config, this.topics.subscriptions);
  }

  stop() {
    this.broker.stop();
  }

  get connected() {
    return this.broker.connected;
  }

  /** The plates seen, sorted by name. */
  list() {
    return [...this.plates.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  get(name) {
    return this.plates.get(name) ?? null;
  }

  #ensure(name) {
    let plate = this.plates.get(name);
    if (!plate) {
      plate = newPlate(name);
      this.plates.set(name, plate);
      logger.info(`Plate "${name}" found`);
      this.emit('plate-added', plate);
    }
    return plate;
  }

  #setOnline(plate, online) {
    plate.lastSeen = online ? this.now() : plate.lastSeen;
    if (plate.online === online) {
      return;
    }
    const previous = plate.online;
    plate.online = online;
    logger.info(`Plate "${plate.name}" is ${online ? 'online' : 'offline'}`);
    this.emit('plate-online', plate, previous);
    if (online && this.connected) {
      // A plate that (re)appears: ask for what it shows, it does not repeat it
      // on its own until its next telemetry.
      this.requestState(plate.name).catch((err) =>
        logger.debug(`State request to "${plate.name}" failed: ${err.message}`),
      );
    }
  }

  /** One MQTT message. Never throws: a strange payload is logged and dropped. */
  handleMessage(topic, payload) {
    const parsed = this.topics.parse(topic);
    if (!parsed) {
      return;
    }
    try {
      if (parsed.kind === 'discovery') {
        this.#onDiscovery(payload);
      } else if (parsed.kind === 'lwt') {
        if (!isPlateName(parsed.plate)) {
          return;
        }
        const online = parseBoolean(payload);
        if (online !== null) {
          this.#setOnline(this.#ensure(parsed.plate), online);
        }
      } else if (parsed.kind === 'state') {
        if (!isPlateName(parsed.plate)) {
          return;
        }
        const plate = this.#ensure(parsed.plate);
        this.#setOnline(plate, true);
        this.#onState(plate, parsed.key, payload);
      }
    } catch (err) {
      logger.warn(`Message on ${topic} ignored: ${err.message}`);
    }
  }

  #onDiscovery(payload) {
    const info = parsePlateInfo(payload);
    if (!info?.node || !isPlateName(info.node)) {
      return;
    }
    const plate = this.#ensure(info.node);
    this.#applyInfo(plate, info, true);
    this.#setOnline(plate, true);
  }

  /** Model, firmware, pages... from a discovery or a statusupdate. */
  #applyInfo(plate, info, fromDiscovery) {
    let infoChanged = false;
    for (const key of ['hwid', 'model', 'version', 'pages', 'ip']) {
      if (info[key] !== null && info[key] !== undefined && plate[key] !== info[key]) {
        plate[key] = info[key];
        infoChanged = true;
      }
    }
    if (infoChanged) {
      this.emit('plate-info', plate);
    }
    if (fromDiscovery) {
      return;
    }
    let updated = false;
    if (info.rssi !== null && plate.rssi !== info.rssi) {
      plate.rssi = info.rssi;
      updated = true;
    }
    if (info.idle !== null && plate.idle !== info.idle) {
      plate.idle = info.idle;
      updated = true;
    }
    if (info.page !== null) {
      updated = this.#setPage(plate, info.page) || updated;
    }
    if (updated) {
      this.emit('plate-updated', plate);
    }
  }

  /** @returns {boolean} whether the page changed */
  #setPage(plate, page) {
    if (plate.page === page) {
      return false;
    }
    const previous = plate.page;
    plate.page = page;
    // The first page known is a reading, not a change: a scene "page changed"
    // must not fire because the integration (re)started.
    if (previous !== null) {
      this.emit('page-changed', plate, page, previous);
    }
    return true;
  }

  #onState(plate, key, payload) {
    if (key === 'statusupdate') {
      const info = parsePlateInfo(payload);
      if (info) {
        this.#applyInfo(plate, info, false);
      }
      return;
    }
    if (key === 'page') {
      const page = parsePage(payload);
      if (page !== null && this.#setPage(plate, page)) {
        this.emit('plate-updated', plate);
      }
      return;
    }
    if (key === 'backlight') {
      const backlight = parseBacklight(payload);
      if (!backlight) {
        return;
      }
      let updated = false;
      if (backlight.on !== null && plate.backlight !== backlight.on) {
        plate.backlight = backlight.on;
        updated = true;
      }
      if (backlight.brightness !== null && plate.brightness !== backlight.brightness) {
        plate.brightness = backlight.brightness;
        updated = true;
      }
      if (updated) {
        this.emit('plate-updated', plate);
      }
      return;
    }
    if (key === 'idle') {
      const idle = parseIdle(payload);
      if (idle !== null && plate.idle !== idle) {
        plate.idle = idle;
        this.emit('plate-updated', plate);
      }
      return;
    }
    if (isObjectId(key)) {
      const event = parseObjectEvent(payload);
      if (!event) {
        return;
      }
      this.#remember(plate, key, event);
      this.emit('object-event', plate, key, event);
    }
  }

  #remember(plate, object, event) {
    if (!plate.objectsHeard.has(object) && plate.objectsHeard.size >= MAX_OBJECTS_HEARD) {
      return;
    }
    plate.objectsHeard.set(object, { ...event, at: this.now() });
  }

  // --- Orders ----------------------------------------------------------------

  /**
   * Send `<prefix>/<plate>/command/<keyword>` with `payload`.
   * @param {string} plate
   * @param {string} keyword e.g. `page`, `backlight`, `p1b2.text`
   * @param {string} [payload] empty = "tell me the current value"
   */
  async command(plate, keyword, payload = '') {
    if (!isPlateName(plate)) {
      throw new Error(`Invalid plate name "${plate}"`);
    }
    logger.debug(`-> ${plate} ${keyword} ${payload}`);
    await this.broker.publish(this.topics.command(plate, keyword), String(payload));
  }

  /** Free command line: `page 2`, `p1b2.text=Hello`, `jsonl {...}`. */
  async sendRaw(plate, line) {
    const text = String(line ?? '').trim();
    if (!text) {
      throw new Error('Empty command');
    }
    if (!isPlateName(plate)) {
      throw new Error(`Invalid plate name "${plate}"`);
    }
    logger.debug(`-> ${plate} ${text}`);
    await this.broker.publish(this.topics.command(plate), text);
  }

  async showPage(plate, page) {
    const number = Number(page);
    if (!Number.isInteger(number) || number < 1 || number > 12) {
      throw new Error(`Invalid page "${page}" (1-12)`);
    }
    await this.command(plate, 'page', String(number));
  }

  /**
   * @param {string} plate
   * @param {{ on?: boolean, brightness?: number }} backlight brightness 1-255
   */
  async setBacklight(plate, { on, brightness }) {
    const body = {};
    if (on !== undefined) {
      body.state = on ? 'on' : 'off';
    }
    if (brightness !== undefined && brightness !== null) {
      body.brightness = Math.max(1, Math.min(255, Math.round(brightness)));
    }
    await this.command(plate, 'backlight', JSON.stringify(body));
  }

  /** @param {'off' | 'short' | 'long'} idle `off` wakes the screen up */
  async setIdle(plate, idle) {
    await this.command(plate, 'idle', idle);
  }

  /** `p1b2.text`, `p1b2.val`... */
  async setObjectProperty(plate, object, property, value) {
    if (!isObjectId(object)) {
      throw new Error(`Invalid object "${object}" (expected e.g. p1b2)`);
    }
    if (!/^[a-z_0-9]+$/.test(property)) {
      throw new Error(`Invalid property "${property}"`);
    }
    await this.command(plate, `${object}.${property}`, String(value));
  }

  /** Ask a plate for what it shows: it answers on its state topics. */
  async requestState(plate) {
    for (const keyword of ['statusupdate', 'backlight', 'page', 'idle']) {
      await this.command(plate, keyword, '');
    }
  }

  /** Ask every plate to say who it is (`discovery/<hwid>`) and ask the known ones for their state. */
  async discover() {
    await this.broker.publish(this.topics.broadcast('discovery'), '');
    await this.broker.publish(this.topics.broadcast('statusupdate'), '');
  }

  /** Wake the screen and blink it three times, then put the backlight back. */
  async identify(plate) {
    const known = this.get(plate);
    const brightness = known?.brightness ?? 255;
    await this.setIdle(plate, 'off');
    for (let i = 0; i < 3; i += 1) {
      await this.setBacklight(plate, { on: false });
      await this.sleep(400);
      await this.setBacklight(plate, { on: true, brightness });
      await this.sleep(400);
    }
    if (known?.backlight === false) {
      await this.setBacklight(plate, { on: false });
    }
  }
}
