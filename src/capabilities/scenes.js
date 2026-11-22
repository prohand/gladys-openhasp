// -----------------------------------------------------------------------------
// Scene triggers and scene actions (manifest `scene_triggers` / `scene_actions`).
//
// Triggers (something happened on a plate):
//   object_event  an object was touched (down, up, long, release)
//   plate_status  a plate went online or offline
//   page_changed  a plate shows another page
//
// Actions (an order for a plate), each answering `{ sent }`:
//   show_page, set_object_text, set_backlight, wake_screen, send_command
//
// Keys are stored in users' scenes: never rename them.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { isObjectId } from '../config.js';
import { plateIds } from '../devices/plate.js';
import { plateNameOf } from '../devices/index.js';

const logger = createLogger({ name: 'scenes' });

export const SCENE_TRIGGERS = {
  OBJECT_EVENT: 'object_event',
  PLATE_STATUS: 'plate_status',
  PAGE_CHANGED: 'page_changed',
};

/**
 * The touch events that fire `object_event`. `changed` (a slider being
 * dragged) and `hold` (every 200 ms while held) are left out: one event per
 * transition, never a stream.
 */
export const TRIGGER_EVENTS = ['down', 'up', 'long', 'release'];

export const PLATE_STATUSES = ['online', 'offline'];

export const SCENE_ACTIONS = {
  SHOW_PAGE: 'show_page',
  SET_OBJECT_TEXT: 'set_object_text',
  SET_BACKLIGHT: 'set_backlight',
  WAKE_SCREEN: 'wake_screen',
  SEND_COMMAND: 'send_command',
};

/** `data` of an `object_event`: flat, only the declared keys. */
export function objectEventData(gladys, plate, object, event) {
  return {
    plate: plateIds(gladys, plate.name).device,
    object,
    event: event.event,
    value: event.val,
    text: event.text,
  };
}

/** `data` of a `plate_status`. */
export function plateStatusData(gladys, plate) {
  return {
    plate: plateIds(gladys, plate.name).device,
    status: plate.online ? 'online' : 'offline',
  };
}

/** `data` of a `page_changed`. */
export function pageChangedData(gladys, plate, page) {
  return { plate: plateIds(gladys, plate.name).device, page };
}

/**
 * The plate a scene action targets. The select lists every device of the
 * integration: a screen object picked by mistake means its plate.
 */
function targetPlate(gladys, fields) {
  const name = plateNameOf(gladys, fields.plate);
  if (!name) {
    throw new Error(`Unknown plate "${fields.plate}"`);
  }
  return name;
}

/**
 * Run an order unless the plate cannot receive it. Not receiving it is an
 * output (`sent: false`), never a failure: a scene action is not a condition,
 * the scene author gates on `sent`.
 */
async function send(hub, plateName, order) {
  if (!hub.connected) {
    logger.warn(`Not sent to "${plateName}": broker not connected`);
    return { sent: false };
  }
  if (hub.get(plateName)?.online === false) {
    logger.warn(`Not sent to "${plateName}": plate offline`);
    return { sent: false };
  }
  await order();
  return { sent: true };
}

/** Handlers, keyed by scene action key: `(gladys, hub, fields) => outputs`. */
export const SCENE_ACTION_HANDLERS = {
  [SCENE_ACTIONS.SHOW_PAGE]: async (gladys, hub, fields) => {
    const plate = targetPlate(gladys, fields);
    return send(hub, plate, () => hub.showPage(plate, fields.page));
  },

  [SCENE_ACTIONS.SET_OBJECT_TEXT]: async (gladys, hub, fields) => {
    const plate = targetPlate(gladys, fields);
    const object = String(fields.object ?? '')
      .trim()
      .toLowerCase();
    if (!isObjectId(object)) {
      throw new Error(`Invalid object "${fields.object}" (expected e.g. p1b2)`);
    }
    return send(hub, plate, () =>
      hub.setObjectProperty(plate, object, 'text', String(fields.text ?? '')),
    );
  },

  [SCENE_ACTIONS.SET_BACKLIGHT]: async (gladys, hub, fields) => {
    const plate = targetPlate(gladys, fields);
    const on = fields.state !== 'off';
    const brightness =
      on &&
      fields.brightness !== undefined &&
      fields.brightness !== null &&
      fields.brightness !== ''
        ? Number(fields.brightness)
        : undefined;
    return send(hub, plate, () => hub.setBacklight(plate, { on, brightness }));
  },

  [SCENE_ACTIONS.WAKE_SCREEN]: async (gladys, hub, fields) => {
    const plate = targetPlate(gladys, fields);
    return send(hub, plate, () => hub.setIdle(plate, 'off'));
  },

  [SCENE_ACTIONS.SEND_COMMAND]: async (gladys, hub, fields) => {
    const plate = targetPlate(gladys, fields);
    return send(hub, plate, () => hub.sendRaw(plate, fields.command));
  },
};
