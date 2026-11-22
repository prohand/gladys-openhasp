// -----------------------------------------------------------------------------
// The integration: Gladys on one side, the MQTT broker of the plates on the
// other. Registers every Gladys handler and turns what the plates say into
// states, scene events and widget refreshes.
//
// Kept apart from index.js so the tests can run it against the SDK's fake
// Gladys and a fake broker: `createApp(gladys, { connect })`.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { setTimeout as delay } from 'node:timers/promises';
import { normalizeConfig, redactUrl } from './config.js';
import { message } from './i18n.js';
import { Broker } from './openhasp/broker.js';
import { Hub } from './openhasp/hub.js';
import { buildDiscoveredDevices, buildTransportEntries, setValue } from './devices/index.js';
import { plateStates } from './devices/plate.js';
import { OBJECT_FEATURES, objectIds, stateFromEvent } from './devices/objects.js';
import {
  SCENE_ACTIONS,
  SCENE_ACTION_HANDLERS,
  SCENE_TRIGGERS,
  TRIGGER_EVENTS,
  objectEventData,
  pageChangedData,
  plateStatusData,
} from './capabilities/scenes.js';
import { PLATES_WIDGET, buildPlatesWidget, runWidgetAction } from './capabilities/widget.js';
import { ACTIONS, createActionHandlers } from './capabilities/actions.js';

const logger = createLogger({ name: 'openhasp' });

/** New plates often arrive together (one discovery each): publish them in one go. */
export const DISCOVERY_DEBOUNCE_MS = 2000;

/** The settings that need a new MQTT connection when they change. */
function connectionKey(config) {
  return JSON.stringify([
    config.mqtt_url,
    config.mqtt_username,
    config.mqtt_password,
    config.topic_prefix,
  ]);
}

/**
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {{ connect?: Function, sleep?: (ms: number) => Promise<void>, debounceMs?: number,
 *   waits?: { BROKER: number, PLATES: number } }} [options]
 */
export function createApp(gladys, options = {}) {
  const sleep = options.sleep ?? ((ms) => delay(ms));
  const debounceMs = options.debounceMs ?? DISCOVERY_DEBOUNCE_MS;
  const broker = new Broker({ connect: options.connect });
  const hub = new Hub({ broker, sleep });

  let rawConfig = {};
  let config = normalizeConfig();
  let currentConnection = null;
  let publishTimer = null;
  // The transport badges last sent: the plates' online status flaps less than
  // the events that make us check it.
  let lastTransports = null;

  // --- Gladys side: publications, never fatal ------------------------------

  const safely = (what, promise) =>
    Promise.resolve(promise).catch((err) => logger.warn(`${what} failed: ${err.message}`));

  async function publishDevices() {
    await gladys.publishDiscoveredDevices(buildDiscoveredDevices(gladys, hub, config));
    // A device the user creates meanwhile needs its badge: always re-send here.
    await publishTransports({ force: true });
  }

  function schedulePublishDevices() {
    clearTimeout(publishTimer);
    publishTimer = setTimeout(() => {
      publishTimer = null;
      safely('Device publication', publishDevices());
    }, debounceMs);
    publishTimer.unref?.();
  }

  async function publishTransports({ force = false } = {}) {
    const entries = buildTransportEntries(gladys, hub, config);
    const signature = JSON.stringify(entries);
    if (!force && signature === lastTransports) {
      return;
    }
    for (let i = 0; i < entries.length; i += 100) {
      await gladys.publishTransports(entries.slice(i, i + 100));
    }
    // Only once Gladys took them: a refused batch is sent again next time.
    lastTransports = signature;
  }

  async function reportConnection() {
    if (!config.mqtt_url) {
      await gladys.setConnectionStatus(false, {
        en: 'Fill in the address of the MQTT broker your plates use.',
        fr: "Renseignez l'adresse du broker MQTT utilisé par vos écrans.",
        de: 'Trage die Adresse des MQTT-Brokers deiner Displays ein.',
        es: 'Indique la dirección del broker MQTT que usan sus pantallas.',
      });
      return;
    }
    if (hub.connected) {
      await gladys.setConnectionStatus(true);
      return;
    }
    await gladys.setConnectionStatus(
      false,
      message(
        {
          en: 'Not connected to the MQTT broker {url} ({error}).',
          fr: 'Pas connecté au broker MQTT {url} ({error}).',
          de: 'Nicht mit dem MQTT-Broker {url} verbunden ({error}).',
          es: 'Sin conexión con el broker MQTT {url} ({error}).',
        },
        { url: redactUrl(config.mqtt_url), error: broker.lastError ?? 'connecting' },
      ),
    );
  }

  function refreshWidget() {
    gladys.requestWidgetRefresh(PLATES_WIDGET);
  }

  function sceneEvent(key, data) {
    return safely(`Scene event ${key}`, gladys.publishSceneEvent(key, data));
  }

  // --- Configuration ---------------------------------------------------------

  function applyConfig(raw) {
    rawConfig = { ...(raw ?? {}) };
    config = normalizeConfig(rawConfig);
    for (const error of config.objectErrors) {
      logger.warn(`objects setting: ${error}`);
    }
    const key = connectionKey(config);
    if (key !== currentConnection) {
      currentConnection = key;
      hub.start(config);
    }
  }

  function reconnect() {
    currentConnection = connectionKey(config);
    hub.start(config);
  }

  async function saveObjects(objects) {
    await gladys.setConfig({ objects });
    applyConfig({ ...rawConfig, objects });
    await publishDevices();
  }

  // --- Plate side: what the broker and the plates say -----------------------

  broker.on('connected', () => {
    safely('Connection status', reportConnection());
    safely('Discovery request', hub.discover());
    safely('Transports', publishTransports());
    refreshWidget();
  });

  broker.on('disconnected', () => {
    safely('Connection status', reportConnection());
    safely('Transports', publishTransports());
    refreshWidget();
  });

  hub.on('plate-added', () => schedulePublishDevices());
  hub.on('plate-info', () => schedulePublishDevices());

  hub.on('plate-online', (plate, previous) => {
    safely('Transports', publishTransports());
    refreshWidget();
    // The first status after a (re)start is a reading, not a change.
    if (previous !== null) {
      sceneEvent(SCENE_TRIGGERS.PLATE_STATUS, plateStatusData(gladys, plate));
    }
  });

  hub.on('plate-updated', (plate) => {
    safely('Plate states', gladys.publishChangedStates(plateStates(gladys, plate)));
    refreshWidget();
  });

  hub.on('page-changed', (plate, page) => {
    sceneEvent(SCENE_TRIGGERS.PAGE_CHANGED, pageChangedData(gladys, plate, page));
  });

  hub.on('object-event', (plate, objectId, event) => {
    const object = config.objectList.find(
      (entry) => entry.plate === plate.name && entry.object === objectId,
    );
    if (object) {
      const result = stateFromEvent(object, event);
      if (result) {
        const featureId = objectIds(gladys, object).feature(OBJECT_FEATURES[object.type]);
        safely(
          `State of ${plate.name}.${objectId}`,
          result.dedupe
            ? gladys.publishChangedStates([
                { device_feature_external_id: featureId, state: result.state },
              ])
            : gladys.publishState(featureId, result.state),
        );
      }
    }
    if (TRIGGER_EVENTS.includes(event.event)) {
      sceneEvent(SCENE_TRIGGERS.OBJECT_EVENT, objectEventData(gladys, plate, objectId, event));
    }
  });

  // --- Gladys handlers ------------------------------------------------------

  gladys.onScanRequest(async () => {
    if (hub.connected) {
      await hub.discover();
      await sleep(debounceMs);
    }
    await publishDevices();
  });

  gladys.onSetValue(async (device, feature, value) => {
    logger.info(`Set ${feature.external_id} = ${value}`);
    const published = await setValue(gladys, hub, config, device, feature, value);
    if (published) {
      await gladys.publishChangedStates([
        { device_feature_external_id: feature.external_id, ...published },
      ]);
    }
  });

  const actionHandlers = createActionHandlers({
    gladys,
    hub,
    getConfig: () => config,
    reconnect,
    saveObjects,
    sleep,
    waits: options.waits,
  });
  gladys.onAction(ACTIONS.TEST_CONNECTION, (fields) =>
    actionHandlers[ACTIONS.TEST_CONNECTION](fields),
  );
  gladys.onAction(ACTIONS.DISCOVER_PLATES, (fields) =>
    actionHandlers[ACTIONS.DISCOVER_PLATES](fields),
  );
  gladys.onAction(ACTIONS.IDENTIFY, (fields) => actionHandlers[ACTIONS.IDENTIFY](fields));
  gladys.onAction(ACTIONS.ADD_OBJECT, (fields) => actionHandlers[ACTIONS.ADD_OBJECT](fields));
  gladys.onAction(ACTIONS.LIST_OBJECTS, (fields) => actionHandlers[ACTIONS.LIST_OBJECTS](fields));

  for (const key of Object.values(SCENE_ACTIONS)) {
    gladys.onSceneAction(key, (fields) => SCENE_ACTION_HANDLERS[key](gladys, hub, fields));
  }

  gladys.onWidgetGet(PLATES_WIDGET, async () => buildPlatesWidget(hub));
  gladys.onWidgetAction(PLATES_WIDGET, (actionKey) => runWidgetAction(hub, actionKey));

  gladys.onConfigUpdated(async (newConfig) => {
    logger.info('Configuration updated');
    applyConfig(newConfig);
    await publishDevices();
    await reportConnection();
    refreshWidget();
  });

  gladys.on('connected', async () => {
    try {
      applyConfig(await gladys.getConfig());
      await publishDevices();
      await reportConnection();
      refreshWidget();
    } catch (err) {
      logger.error(`Initialization failed: ${err.message}`);
      await gladys
        .setConnectionStatus(false, {
          en: 'Initialization failed, check the integration logs.',
          fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
          de: 'Die Initialisierung ist fehlgeschlagen, prüfe die Logs der Integration.',
          es: 'La inicialización ha fallado, revise los registros de la integración.',
        })
        .catch(() => {});
    }
  });

  return {
    hub,
    broker,
    getConfig: () => config,
    /** Flush a pending device publication (tests). */
    async flush() {
      if (publishTimer) {
        clearTimeout(publishTimer);
        publishTimer = null;
        await publishDevices();
      }
    },
    stop() {
      clearTimeout(publishTimer);
      publishTimer = null;
      hub.stop();
    },
  };
}
