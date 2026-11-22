// -----------------------------------------------------------------------------
// Reading what a plate sends.
//
// openHASP payloads are JSON most of the time, plain words some of the time,
// and the firmware versions do not all spell things the same way (`ON` / `on`
// / `true`, `numPages` / `pages`, `version` / `sw`). Everything is read here,
// tolerantly: a payload that makes no sense is `null`, never an exception.
// -----------------------------------------------------------------------------

/** JSON when it is JSON, `null` otherwise. */
export function parseJson(payload) {
  const text = String(payload ?? '').trim();
  if (!text.startsWith('{') && !text.startsWith('[')) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const TRUE_WORDS = new Set(['on', 'true', '1', 'yes', 'online']);
const FALSE_WORDS = new Set(['off', 'false', '0', 'no', 'offline']);

/** openHASP booleans: on/off, true/false, 1/0, yes/no. `null` when unknown. */
export function parseBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  const word = String(value ?? '')
    .trim()
    .toLowerCase();
  if (TRUE_WORDS.has(word)) {
    return true;
  }
  if (FALSE_WORDS.has(word)) {
    return false;
  }
  return null;
}

/** A finite number, or `null`. */
export function parseNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** `state/backlight`: `{"state":"on","brightness":255}`. */
export function parseBacklight(payload) {
  const json = parseJson(payload);
  if (json && typeof json === 'object') {
    return {
      on: parseBoolean(json.state),
      brightness: parseNumber(json.brightness),
    };
  }
  const on = parseBoolean(payload);
  return on === null ? null : { on, brightness: null };
}

const IDLE_STATES = new Set(['off', 'short', 'long']);

/** `state/idle`: off | short | long. */
export function parseIdle(payload) {
  const word = String(payload ?? '')
    .trim()
    .toLowerCase();
  return IDLE_STATES.has(word) ? word : null;
}

/** `state/page`: the page number shown. */
export function parsePage(payload) {
  const page = parseNumber(String(payload ?? '').trim());
  return page !== null && Number.isInteger(page) && page >= 0 && page <= 12 ? page : null;
}

/**
 * `discovery/<hwid>` (0.7: `mdl`, `sw`, `pages`, `uri`) and
 * `state/statusupdate` (`version`, `numPages`, `ip`, `rssi`, `page`).
 * Only the fields the integration uses; missing ones are `null`.
 */
export function parsePlateInfo(payload) {
  const json = parseJson(payload);
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return null;
  }
  let ip = typeof json.ip === 'string' ? json.ip : null;
  if (!ip && typeof json.uri === 'string') {
    try {
      ip = new URL(json.uri).hostname || null;
    } catch {
      ip = null;
    }
  }
  const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  return {
    node: text(json.node),
    hwid: text(json.hwid) ?? text(json.mac),
    model: text(json.mdl) ?? text(json.model),
    version: text(json.sw) ?? text(json.version),
    pages: parseNumber(json.pages ?? json.numPages),
    ip,
    rssi: parseNumber(json.rssi),
    page: parseNumber(json.page),
    idle: parseIdle(json.idle),
  };
}

/** Touch events published by an object (`state/p1b2`). */
export const OBJECT_EVENTS = ['down', 'up', 'long', 'hold', 'release', 'changed'];

/**
 * `state/p1b2`: `{"event":"up","val":1}`, `{"event":"changed","text":"Option 2","val":1}`.
 * @returns {{ event: string, val: number | null, text: string | null } | null}
 */
export function parseObjectEvent(payload) {
  const json = parseJson(payload);
  if (!json || typeof json !== 'object' || !OBJECT_EVENTS.includes(json.event)) {
    return null;
  }
  return {
    event: json.event,
    val: parseNumber(json.val),
    text: typeof json.text === 'string' ? json.text : null,
  };
}

/**
 * WiFi RSSI (dBm) to the 0-5 signal quality Gladys shows as bars.
 * @param {number | null} rssi
 */
export function signalQuality(rssi) {
  if (rssi === null || rssi === undefined) {
    return null;
  }
  if (rssi >= -55) return 5;
  if (rssi >= -65) return 4;
  if (rssi >= -72) return 3;
  if (rssi >= -80) return 2;
  if (rssi >= -90) return 1;
  return 0;
}
