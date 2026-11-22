// -----------------------------------------------------------------------------
// The MQTT connection to the broker the plates talk to.
//
// A thin wrapper around mqtt.js: one connection at a time, re-subscribed on
// every reconnection (mqtt.js reconnects by itself), and a `connect` function
// injected so the tests drive a fake broker — no network in the tests.
//
// Events:
//   'connected'               the broker accepted us, topics subscribed
//   'disconnected'            the link is down (mqtt.js keeps retrying)
//   'message' (topic, text)   a message on a subscribed topic
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import mqtt from 'mqtt';
import { createLogger } from '@gladysassistant/integration-sdk';
import { redactUrl } from '../config.js';

const logger = createLogger({ name: 'mqtt' });

/** Seconds between two reconnection attempts. */
const RECONNECT_PERIOD_MS = 5000;
/** How long the first connection may take before it is reported as failed. */
const CONNECT_TIMEOUT_MS = 10000;

export class Broker extends EventEmitter {
  /**
   * @param {{ connect?: typeof mqtt.connect }} [options]
   */
  constructor({ connect = mqtt.connect } = {}) {
    super();
    this.connectFn = connect;
    this.client = null;
    this.connected = false;
    this.lastError = null;
    this.url = null;
  }

  /**
   * (Re)connect with a configuration. Stops the previous connection first.
   * @param {{ mqtt_url: string | null, mqtt_username: string, mqtt_password: string }} config
   * @param {string[]} subscriptions
   */
  start(config, subscriptions) {
    this.stop();
    this.lastError = null;
    this.url = config.mqtt_url;
    if (!config.mqtt_url) {
      return;
    }
    logger.info(`Connecting to ${redactUrl(config.mqtt_url)}`);
    const client = this.connectFn(config.mqtt_url, {
      username: config.mqtt_username || undefined,
      password: config.mqtt_password || undefined,
      // A random suffix: two Gladys (or a restart racing the old container)
      // must not kick each other off the broker with the same client id.
      clientId: `gladys-openhasp-${randomBytes(4).toString('hex')}`,
      reconnectPeriod: RECONNECT_PERIOD_MS,
      connectTimeout: CONNECT_TIMEOUT_MS,
      clean: true,
    });
    this.client = client;

    client.on('connect', () => {
      if (this.client !== client) {
        return;
      }
      client.subscribe(subscriptions, { qos: 0 }, (err) => {
        if (this.client !== client) {
          return;
        }
        if (err) {
          this.lastError = err.message;
          logger.error(`Subscription failed: ${err.message}`);
          return;
        }
        this.connected = true;
        this.lastError = null;
        logger.info(`Connected, listening to ${subscriptions.join(', ')}`);
        this.emit('connected');
      });
    });
    client.on('message', (topic, payload) => {
      if (this.client === client) {
        this.emit('message', topic, payload.toString('utf8'));
      }
    });
    client.on('error', (err) => {
      if (this.client !== client) {
        return;
      }
      // Never log the error object itself: some carry the connect options.
      this.lastError = err?.message ?? String(err);
      logger.warn(`Broker error: ${this.lastError}`);
    });
    client.on('close', () => this.#lost(client));
    client.on('offline', () => this.#lost(client));
  }

  #lost(client) {
    if (this.client !== client || !this.connected) {
      return;
    }
    this.connected = false;
    logger.warn('Disconnected from the broker, retrying');
    this.emit('disconnected');
  }

  /** Close the connection, without reconnecting. */
  stop() {
    const client = this.client;
    this.client = null;
    const wasConnected = this.connected;
    this.connected = false;
    if (client) {
      client.removeAllListeners();
      // Swallow the late errors of a client being torn down.
      client.on('error', () => {});
      client.end(true);
    }
    if (wasConnected) {
      this.emit('disconnected');
    }
  }

  /**
   * Publish a message. Rejects when the broker is not connected: an order that
   * cannot leave must say so, not wait in a queue and fire minutes later.
   * @param {string} topic
   * @param {string} payload
   */
  publish(topic, payload) {
    const client = this.client;
    if (!client || !this.connected) {
      return Promise.reject(new Error('Not connected to the MQTT broker'));
    }
    return new Promise((resolve, reject) => {
      client.publish(topic, payload, { qos: 0, retain: false }, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Resolves `true` once connected, `false` after `timeoutMs`.
   * @param {number} timeoutMs
   */
  waitConnected(timeoutMs) {
    if (this.connected) {
      return Promise.resolve(true);
    }
    if (!this.client) {
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      const done = (value) => {
        clearTimeout(timer);
        this.off('connected', onConnected);
        resolve(value);
      };
      const onConnected = () => done(true);
      const timer = setTimeout(() => done(false), timeoutMs);
      this.on('connected', onConnected);
    });
  }
}
