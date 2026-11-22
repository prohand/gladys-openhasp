// -----------------------------------------------------------------------------
// Buttons of the Configuration screen (manifest `actions`).
//
//   test_connection  reconnect to the broker and say what answered
//   discover_plates  ask every plate to introduce itself
//   identify         blink the screen of the chosen plate
//   add_object       add a screen object to the `objects` setting
//   list_objects     the objects touched lately that are not devices yet
//
// Each handler resolves the multi-language message shown under the button.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { OBJECT_TYPES, formatObjects, isObjectId, redactUrl } from '../config.js';
import { message } from '../i18n.js';
import { plateNameOf } from '../devices/index.js';

const logger = createLogger({ name: 'actions' });

export const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
  DISCOVER_PLATES: 'discover_plates',
  IDENTIFY: 'identify',
  ADD_OBJECT: 'add_object',
  LIST_OBJECTS: 'list_objects',
};

/** How long the test waits for the broker, then for the plates to answer. */
export const TEST_WAIT_MS = { BROKER: 10000, PLATES: 3000 };

const NO_URL = {
  en: 'Fill in the MQTT broker address first (e.g. mqtt://192.168.1.10:1883).',
  fr: "Renseignez d'abord l'adresse du broker MQTT (ex. mqtt://192.168.1.10:1883).",
  de: 'Trage zuerst die Adresse des MQTT-Brokers ein (z. B. mqtt://192.168.1.10:1883).',
  es: 'Primero indique la dirección del broker MQTT (p. ej. mqtt://192.168.1.10:1883).',
};

function notConnected(hub, config) {
  return message(
    {
      en: 'Cannot reach the broker {url}: {error}',
      fr: 'Impossible de joindre le broker {url} : {error}',
      de: 'Der Broker {url} ist nicht erreichbar: {error}',
      es: 'No se puede conectar con el broker {url}: {error}',
    },
    { url: redactUrl(config.mqtt_url), error: hub.broker.lastError ?? 'timeout' },
  );
}

function platesSummary(hub) {
  const plates = hub.list();
  const online = plates.filter((plate) => plate.online === true).map((plate) => plate.name);
  return { count: online.length, names: online.join(', ') || '-' };
}

/**
 * @param {{ gladys: import('@gladysassistant/integration-sdk').GladysIntegration,
 *   hub: import('../openhasp/hub.js').Hub,
 *   getConfig: () => object,
 *   reconnect: () => void,
 *   saveObjects: (objects: string) => Promise<void>,
 *   sleep: (ms: number) => Promise<void>,
 *   waits?: { BROKER: number, PLATES: number } }} context
 */
export function createActionHandlers({
  gladys,
  hub,
  getConfig,
  reconnect,
  saveObjects,
  sleep,
  waits = TEST_WAIT_MS,
}) {
  return {
    async [ACTIONS.TEST_CONNECTION]() {
      const config = getConfig();
      if (!config.mqtt_url) {
        return NO_URL;
      }
      reconnect();
      if (!(await hub.broker.waitConnected(waits.BROKER))) {
        return notConnected(hub, config);
      }
      await hub.discover();
      await sleep(waits.PLATES);
      return message(
        {
          en: 'Connected to {url}. Plates online: {count} ({names}).',
          fr: 'Connecté à {url}. Écrans en ligne : {count} ({names}).',
          de: 'Verbunden mit {url}. Displays online: {count} ({names}).',
          es: 'Conectado a {url}. Pantallas en línea: {count} ({names}).',
        },
        { url: redactUrl(config.mqtt_url), ...platesSummary(hub) },
      );
    },

    async [ACTIONS.DISCOVER_PLATES]() {
      const config = getConfig();
      if (!config.mqtt_url) {
        return NO_URL;
      }
      if (!hub.connected) {
        return notConnected(hub, config);
      }
      await hub.discover();
      await sleep(waits.PLATES);
      return message(
        {
          en: 'Plates online: {count} ({names}). Add them from the Discovery tab.',
          fr: "Écrans en ligne : {count} ({names}). Ajoutez-les depuis l'onglet Découverte.",
          de: 'Displays online: {count} ({names}). Füge sie im Tab Erkennung hinzu.',
          es: 'Pantallas en línea: {count} ({names}). Añádalas desde la pestaña Descubrimiento.',
        },
        platesSummary(hub),
      );
    },

    async [ACTIONS.IDENTIFY](fields) {
      const plate = plateNameOf(gladys, fields.device);
      if (!plate) {
        throw new Error(`Unknown device "${fields.device}"`);
      }
      await hub.identify(plate);
      return message(
        {
          en: 'The screen of {plate} blinked three times.',
          fr: "L'écran de {plate} a clignoté trois fois.",
          de: 'Das Display von {plate} hat dreimal geblinkt.',
          es: 'La pantalla de {plate} ha parpadeado tres veces.',
        },
        { plate },
      );
    },

    async [ACTIONS.ADD_OBJECT](fields) {
      const plate = plateNameOf(gladys, fields.plate);
      const object = String(fields.object ?? '')
        .trim()
        .toLowerCase();
      if (!plate) {
        throw new Error(`Unknown plate "${fields.plate}"`);
      }
      if (!isObjectId(object)) {
        throw new Error(`Invalid object "${fields.object}" (expected e.g. p1b2)`);
      }
      if (!Object.values(OBJECT_TYPES).includes(fields.type)) {
        throw new Error(`Unknown type "${fields.type}"`);
      }
      const config = getConfig();
      const name = String(fields.name ?? '').trim() || `${plate} ${object}`;
      const others = config.objectList.filter(
        (entry) => !(entry.plate === plate && entry.object === object),
      );
      const replaced = others.length !== config.objectList.length;
      await saveObjects(formatObjects([...others, { plate, object, type: fields.type, name }]));
      logger.info(`Object ${plate}.${object} (${fields.type}) ${replaced ? 'updated' : 'added'}`);
      return message(
        {
          en: '{name} ({plate}.{object}) saved. Add it from the Discovery tab.',
          fr: "{name} ({plate}.{object}) enregistré. Ajoutez-le depuis l'onglet Découverte.",
          de: '{name} ({plate}.{object}) gespeichert. Füge es im Tab Erkennung hinzu.',
          es: '{name} ({plate}.{object}) guardado. Añádalo desde la pestaña Descubrimiento.',
        },
        { name, plate, object },
      );
    },

    async [ACTIONS.LIST_OBJECTS]() {
      const config = getConfig();
      const declared = new Set(config.objectList.map((entry) => `${entry.plate}.${entry.object}`));
      const heard = hub
        .list()
        .flatMap((plate) =>
          [...plate.objectsHeard.keys()].map((object) => `${plate.name}.${object}`),
        )
        .filter((address) => !declared.has(address))
        .sort();
      if (heard.length === 0) {
        return {
          en: 'No new object touched yet: touch the buttons of your plates, then try again.',
          fr: "Aucun nouvel objet touché pour l'instant : touchez les boutons de vos écrans, puis réessayez.",
          de: 'Noch kein neues Objekt berührt: Tippe auf die Tasten deiner Displays und versuche es erneut.',
          es: 'Todavía no se ha tocado ningún objeto nuevo: toque los botones de sus pantallas y vuelva a intentarlo.',
        };
      }
      return message(
        {
          en: 'Objects touched, not declared yet: {list}',
          fr: 'Objets touchés, pas encore déclarés : {list}',
          de: 'Berührte, noch nicht angelegte Objekte: {list}',
          es: 'Objetos tocados, aún no declarados: {list}',
        },
        { list: heard.slice(0, 40).join(', ') },
      );
    },
  };
}
