// -----------------------------------------------------------------------------
// Dashboard widget "openHASP plates" (manifest `widgets`).
//
// One row per plate (online or not, page shown, WiFi), a tile with how many
// are online, and two buttons: wake every screen, look for new plates.
// The rows are computed: src/app.js nudges the widget when a plate changes.
// -----------------------------------------------------------------------------

import { createLogger, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { message } from '../i18n.js';

const logger = createLogger({ name: 'widget' });

export const PLATES_WIDGET = 'plates';

export const WIDGET_ACTIONS = {
  WAKE_ALL: 'wake_all',
  DISCOVER: 'discover',
};

/** Status list rows are capped at 10 by the core. */
const MAX_ROWS = 10;

function plateRow(plate, brokerConnected) {
  const label = plate.name.slice(0, 40);
  if (!brokerConnected || plate.online !== true) {
    return {
      label,
      icon: 'monitor',
      value: plate.online === false ? OFFLINE : UNKNOWN,
      color: plate.online === false ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
    };
  }
  const value =
    plate.page !== null
      ? message(
          {
            en: 'Online, page {page}',
            fr: 'En ligne, page {page}',
            de: 'Online, Seite {page}',
            es: 'En línea, página {page}',
          },
          { page: plate.page },
        )
      : ONLINE;
  return {
    label,
    icon: 'monitor',
    value,
    color: plate.idle && plate.idle !== 'off' ? WIDGET_COLORS.INFO : WIDGET_COLORS.SUCCESS,
  };
}

const ONLINE = { en: 'Online', fr: 'En ligne', de: 'Online', es: 'En línea' };
const OFFLINE = { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Sin conexión' };
const UNKNOWN = { en: 'Unknown', fr: 'Inconnu', de: 'Unbekannt', es: 'Desconocido' };

/**
 * The widget content.
 * @param {import('../openhasp/hub.js').Hub} hub
 */
export function buildPlatesWidget(hub) {
  const plates = hub.list();
  const online = plates.filter((plate) => hub.connected && plate.online === true).length;
  const components = [];

  if (!hub.connected) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: {
        en: 'Not connected to the MQTT broker.',
        fr: 'Pas connecté au broker MQTT.',
        de: 'Nicht mit dem MQTT-Broker verbunden.',
        es: 'Sin conexión con el broker MQTT.',
      },
    });
  } else if (plates.length === 0) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: {
        en: 'No plate seen yet on the broker.',
        fr: "Aucun écran vu sur le broker pour l'instant.",
        de: 'Noch kein Display am Broker gesehen.',
        es: 'Todavía no se ha visto ninguna pantalla en el broker.',
      },
    });
  }

  components.push({
    type: 'value',
    label: { en: 'Online', fr: 'En ligne', de: 'Online', es: 'En línea' },
    icon: 'wifi',
    value: `${online}/${plates.length}`,
    color:
      online === plates.length && plates.length > 0 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.WARNING,
  });

  if (plates.length > 0) {
    components.push({
      type: 'status',
      items: plates.slice(0, MAX_ROWS).map((plate) => plateRow(plate, hub.connected)),
    });
  }

  components.push(
    {
      type: 'button',
      label: { en: 'Wake screens', fr: 'Réveiller', de: 'Aufwecken', es: 'Despertar' },
      icon: 'sun',
      style: 'primary',
      action: { key: WIDGET_ACTIONS.WAKE_ALL },
    },
    {
      type: 'button',
      label: { en: 'Find plates', fr: 'Chercher', de: 'Suchen', es: 'Buscar' },
      icon: 'search',
      style: 'secondary',
      action: { key: WIDGET_ACTIONS.DISCOVER },
    },
  );

  return { ttl_seconds: 120, components };
}

/**
 * A tapped button. Resolves the toast.
 * @param {import('../openhasp/hub.js').Hub} hub
 * @param {string} actionKey
 */
export async function runWidgetAction(hub, actionKey) {
  logger.info(`Widget action ${actionKey}`);
  if (!hub.connected) {
    throw new Error('Not connected to the MQTT broker');
  }
  if (actionKey === WIDGET_ACTIONS.WAKE_ALL) {
    const plates = hub.list().filter((plate) => plate.online !== false);
    for (const plate of plates) {
      await hub.setIdle(plate.name, 'off');
    }
    return message(
      {
        en: '{n} screen(s) woken up',
        fr: '{n} écran(s) réveillé(s)',
        de: '{n} Display(s) aufgeweckt',
        es: '{n} pantalla(s) despertada(s)',
      },
      { n: plates.length },
    );
  }
  if (actionKey === WIDGET_ACTIONS.DISCOVER) {
    await hub.discover();
    return {
      en: 'Search sent to the plates',
      fr: 'Recherche envoyée aux écrans',
      de: 'Suche an die Displays gesendet',
      es: 'Búsqueda enviada a las pantallas',
    };
  }
  throw new Error(`Unknown widget action: ${actionKey}`);
}
