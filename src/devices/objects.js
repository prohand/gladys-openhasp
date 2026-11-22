// -----------------------------------------------------------------------------
// Device type: SCREEN OBJECT (one object of a plate page, e.g. p1b2)
//
// The user lists the objects to expose in the `objects` setting (or with the
// "Add an object" action). Each one becomes a small Gladys device:
//
//   button  a normal button          -> button (click / long press), read-only
//   switch  toggle, switch, checkbox -> on/off, both ways
//   slider  slider, arc (0-100)      -> level 0-100, both ways
//   text    label, button text       -> text written by Gladys
//
// The platform id is `<plate>.<object>`: the address of the object.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import { OBJECT_TYPES } from '../config.js';

export const OBJECT_DEVICE_TYPE = 'object';

/** The feature key of each object type (one feature per object). */
export const OBJECT_FEATURES = {
  [OBJECT_TYPES.BUTTON]: 'click',
  [OBJECT_TYPES.SWITCH]: 'state',
  [OBJECT_TYPES.SLIDER]: 'level',
  [OBJECT_TYPES.TEXT]: 'text',
};

/** Gladys BUTTON_STATUS values (server/utils/constants.js). */
export const BUTTON_STATUS = {
  CLICK: 1,
  LONG_CLICK_PRESS: 3,
  LONG_CLICK_RELEASE: 4,
};

/** openHASP touch event -> Gladys button value. `down` and `hold` are not clicks. */
const BUTTON_EVENTS = {
  up: BUTTON_STATUS.CLICK,
  long: BUTTON_STATUS.LONG_CLICK_PRESS,
  release: BUTTON_STATUS.LONG_CLICK_RELEASE,
};

export function objectIds(gladys, object) {
  return gladys.externalIds(OBJECT_DEVICE_TYPE, `${object.plate}.${object.object}`);
}

function featureFor(object, ids) {
  const external_id = ids.feature(OBJECT_FEATURES[object.type]);
  const common = { name: object.name, external_id, keep_history: true };
  switch (object.type) {
    case OBJECT_TYPES.BUTTON:
      return {
        ...common,
        category: DEVICE_FEATURE_CATEGORIES.BUTTON,
        type: DEVICE_FEATURE_TYPES.BUTTON.CLICK,
        min: BUTTON_STATUS.CLICK,
        max: BUTTON_STATUS.LONG_CLICK_RELEASE,
        read_only: true,
        has_feedback: false,
      };
    case OBJECT_TYPES.SWITCH:
      return {
        ...common,
        category: DEVICE_FEATURE_CATEGORIES.SWITCH,
        type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
        min: 0,
        max: 1,
        read_only: false,
        has_feedback: true,
      };
    case OBJECT_TYPES.SLIDER:
      return {
        ...common,
        category: DEVICE_FEATURE_CATEGORIES.SWITCH,
        type: DEVICE_FEATURE_TYPES.SWITCH.DIMMER,
        min: 0,
        max: 100,
        read_only: false,
        has_feedback: true,
      };
    default:
      return {
        ...common,
        keep_history: false,
        category: DEVICE_FEATURE_CATEGORIES.TEXT,
        type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
        min: 0,
        max: 0,
        read_only: false,
        has_feedback: false,
      };
  }
}

/** The discovery entry of a screen object. */
export function buildObjectDevice(gladys, object) {
  const ids = objectIds(gladys, object);
  return {
    name: object.name,
    external_id: ids.device,
    features: [featureFor(object, ids)],
  };
}

/**
 * The state a touch event gives the object's feature, or `null` when the event
 * says nothing about it. Only the final events count: `changed` is sent many
 * times a second while a slider is dragged, and `hold` every 200 ms while a
 * button is held — publishing them would hit the 300 states a minute Gladys
 * accepts.
 *
 * @param {{ type: string }} object
 * @param {{ event: string, val: number | null }} event
 * @returns {{ state: number, dedupe: boolean } | null} `dedupe: false` for a
 *   click, which must reach Gladys even when it is the same as the last one
 */
export function stateFromEvent(object, event) {
  switch (object.type) {
    case OBJECT_TYPES.BUTTON: {
      const status = BUTTON_EVENTS[event.event];
      return status ? { state: status, dedupe: false } : null;
    }
    case OBJECT_TYPES.SWITCH:
      if ((event.event === 'up' || event.event === 'release') && event.val !== null) {
        return { state: event.val > 0 ? 1 : 0, dedupe: true };
      }
      return null;
    case OBJECT_TYPES.SLIDER:
      if ((event.event === 'up' || event.event === 'release') && event.val !== null) {
        return { state: Math.max(0, Math.min(100, Math.round(event.val))), dedupe: true };
      }
      return null;
    default:
      return null;
  }
}

/**
 * A command from Gladys on an object.
 * @param {import('../openhasp/hub.js').Hub} hub
 * @param {{ plate: string, object: string, type: string }} object
 * @param {number | string} value
 * @returns {Promise<{ state?: number, text?: string }>} the state to publish back
 */
export async function setObjectValue(hub, object, value) {
  switch (object.type) {
    case OBJECT_TYPES.SWITCH: {
      const state = Number(value) === 1 ? 1 : 0;
      await hub.setObjectProperty(object.plate, object.object, 'val', state);
      return { state };
    }
    case OBJECT_TYPES.SLIDER: {
      const state = Math.max(0, Math.min(100, Math.round(Number(value))));
      if (!Number.isFinite(state)) {
        throw new Error(`Invalid level "${value}"`);
      }
      await hub.setObjectProperty(object.plate, object.object, 'val', state);
      return { state };
    }
    case OBJECT_TYPES.TEXT: {
      const text = String(value ?? '');
      await hub.setObjectProperty(object.plate, object.object, 'text', text);
      return { text };
    }
    default:
      throw new Error(`A ${object.type} object cannot be set from Gladys`);
  }
}
