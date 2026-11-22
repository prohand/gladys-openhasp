// -----------------------------------------------------------------------------
// Device type: PLATE (one openHASP screen)
//
//   backlight   on/off of the screen backlight          (light binary)
//   brightness  backlight level, 0-100 %                (light brightness)
//   page        the page shown, chosen in a list         (text select)
//   awake       on = screen in use, off = idle           (switch binary)
//   signal      WiFi quality, 0-5 bars                   (signal)
//
// The plate name (its MQTT "Plate Name") is the platform id: it is the only
// thing the topics carry, and renaming a plate makes it another device.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { DEFAULT_PAGES } from '../openhasp/hub.js';
import { signalQuality } from '../openhasp/payloads.js';

export const PLATE_TYPE = 'plate';

export const PLATE_FEATURES = {
  BACKLIGHT: 'backlight',
  BRIGHTNESS: 'brightness',
  PAGE: 'page',
  AWAKE: 'awake',
  SIGNAL: 'signal',
};

export function plateIds(gladys, plateName) {
  return gladys.externalIds(PLATE_TYPE, plateName);
}

/** openHASP brightness (1-255) to the Gladys percentage, and back. */
export function brightnessToPercent(brightness) {
  return Math.max(0, Math.min(100, Math.round((brightness / 255) * 100)));
}

export function percentToBrightness(percent) {
  return Math.max(1, Math.min(255, Math.round((percent / 100) * 255)));
}

/**
 * The discovery entry of a plate.
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {{ name: string, pages: number | null, model: string | null }} plate
 */
export function buildPlateDevice(gladys, plate) {
  const ids = plateIds(gladys, plate.name);
  const pages = Math.max(1, Math.min(12, plate.pages ?? DEFAULT_PAGES));
  return {
    name: `openHASP ${plate.name}`,
    external_id: ids.device,
    ...(plate.model ? { model: plate.model } : {}),
    features: [
      {
        name: 'Backlight',
        external_id: ids.feature(PLATE_FEATURES.BACKLIGHT),
        category: DEVICE_FEATURE_CATEGORIES.LIGHT,
        type: DEVICE_FEATURE_TYPES.LIGHT.BINARY,
        min: 0,
        max: 1,
        read_only: false,
        has_feedback: true,
        keep_history: false,
      },
      {
        name: 'Brightness',
        external_id: ids.feature(PLATE_FEATURES.BRIGHTNESS),
        category: DEVICE_FEATURE_CATEGORIES.LIGHT,
        type: DEVICE_FEATURE_TYPES.LIGHT.BRIGHTNESS,
        unit: DEVICE_FEATURE_UNITS.PERCENT,
        min: 0,
        max: 100,
        read_only: false,
        has_feedback: true,
        keep_history: false,
      },
      {
        name: 'Page',
        external_id: ids.feature(PLATE_FEATURES.PAGE),
        category: DEVICE_FEATURE_CATEGORIES.TEXT,
        type: DEVICE_FEATURE_TYPES.TEXT.SELECT,
        min: 0,
        max: 0,
        read_only: false,
        has_feedback: true,
        keep_history: false,
        supported_options: Array.from({ length: pages }, (_, index) => ({
          value: String(index + 1),
          label: `Page ${index + 1}`,
          sort_order: index,
        })),
      },
      {
        name: 'Screen awake',
        external_id: ids.feature(PLATE_FEATURES.AWAKE),
        category: DEVICE_FEATURE_CATEGORIES.SWITCH,
        type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
        min: 0,
        max: 1,
        read_only: false,
        has_feedback: true,
        keep_history: false,
      },
      {
        name: 'WiFi signal',
        external_id: ids.feature(PLATE_FEATURES.SIGNAL),
        category: DEVICE_FEATURE_CATEGORIES.SIGNAL,
        type: DEVICE_FEATURE_TYPES.SIGNAL.QUALITY,
        min: 0,
        max: 5,
        read_only: true,
        has_feedback: false,
        keep_history: true,
      },
    ],
  };
}

/** The states of a plate that are known, in the `publishStates` format. */
export function plateStates(gladys, plate) {
  const ids = plateIds(gladys, plate.name);
  const states = [];
  const add = (key, state) => states.push({ device_feature_external_id: ids.feature(key), state });
  if (plate.backlight !== null) {
    add(PLATE_FEATURES.BACKLIGHT, plate.backlight ? 1 : 0);
  }
  if (plate.brightness !== null) {
    add(PLATE_FEATURES.BRIGHTNESS, brightnessToPercent(plate.brightness));
  }
  if (plate.page !== null) {
    states.push({
      device_feature_external_id: ids.feature(PLATE_FEATURES.PAGE),
      text: String(plate.page),
    });
  }
  if (plate.idle !== null) {
    add(PLATE_FEATURES.AWAKE, plate.idle === 'off' ? 1 : 0);
  }
  const quality = signalQuality(plate.rssi);
  if (quality !== null) {
    add(PLATE_FEATURES.SIGNAL, quality);
  }
  return states;
}

/**
 * A command from Gladys on a plate feature.
 * @param {import('../openhasp/hub.js').Hub} hub
 * @param {string} plateName
 * @param {string} featureKey one of PLATE_FEATURES
 * @param {number | string} value
 * @returns {Promise<{ state?: number, text?: string } | null>} the state to publish back
 */
export async function setPlateValue(hub, plateName, featureKey, value) {
  switch (featureKey) {
    case PLATE_FEATURES.BACKLIGHT: {
      const on = Number(value) === 1;
      await hub.setBacklight(plateName, { on });
      return { state: on ? 1 : 0 };
    }
    case PLATE_FEATURES.BRIGHTNESS: {
      const percent = Math.max(0, Math.min(100, Number(value)));
      if (percent === 0) {
        await hub.setBacklight(plateName, { on: false });
      } else {
        await hub.setBacklight(plateName, { on: true, brightness: percentToBrightness(percent) });
      }
      return { state: percent };
    }
    case PLATE_FEATURES.PAGE: {
      await hub.showPage(plateName, value);
      return { text: String(Number(value)) };
    }
    case PLATE_FEATURES.AWAKE: {
      const awake = Number(value) === 1;
      // `off` resets the idle timer (wakes the screen), `long` forces the long
      // idle the plate is configured with (dimmed or off).
      await hub.setIdle(plateName, awake ? 'off' : 'long');
      return { state: awake ? 1 : 0 };
    }
    default:
      throw new Error(`The ${featureKey} feature of a plate is read-only`);
  }
}
