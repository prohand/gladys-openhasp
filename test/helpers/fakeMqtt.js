// -----------------------------------------------------------------------------
// A fake MQTT broker for the tests: stands in for `mqtt.connect`, records what
// the integration publishes and lets the test play the plates.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';

class FakeClient extends EventEmitter {
  constructor(broker, url, options) {
    super();
    this.broker = broker;
    this.url = url;
    this.options = options;
    this.subscriptions = [];
    this.ended = false;
  }

  subscribe(topics, _options, callback) {
    this.subscriptions.push(...topics);
    queueMicrotask(() => callback?.(this.broker.subscribeError ?? null));
  }

  publish(topic, payload, _options, callback) {
    if (this.broker.publishError) {
      callback?.(this.broker.publishError);
      return;
    }
    this.broker.published.push({ topic, payload: String(payload) });
    callback?.(null);
  }

  end() {
    this.ended = true;
  }
}

export function createFakeMqtt() {
  const broker = {
    clients: [],
    published: [],
    subscribeError: null,
    publishError: null,

    /** The function the integration calls instead of mqtt.connect. */
    connect: (url, options) => {
      const client = new FakeClient(broker, url, options);
      broker.clients.push(client);
      return client;
    },

    get client() {
      return broker.clients.at(-1);
    },

    /** Accept the current connection and wait for the subscription. */
    async accept() {
      broker.client.emit('connect');
      await new Promise((resolve) => setImmediate(resolve));
    },

    /** A message from a plate. */
    receive(topic, payload) {
      const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
      broker.client.emit('message', topic, Buffer.from(text));
    },

    /** Drop the link, as a broker restart would. */
    drop() {
      broker.client.emit('close');
    },

    /** What was published on one topic. */
    on(topic) {
      return broker.published.filter((message) => message.topic === topic).map((m) => m.payload);
    },

    clear() {
      broker.published.length = 0;
    },
  };
  return broker;
}

/** Let the pending promises (states, scene events...) settle. */
export function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}
