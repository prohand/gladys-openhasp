// -----------------------------------------------------------------------------
// Configuration: defaults, normalization and the list of screen objects.
//
// The defaults MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (test/manifest.test.js checks it).
// -----------------------------------------------------------------------------

/** The kinds of screen objects the integration turns into Gladys devices. */
export const OBJECT_TYPES = {
  // A normal button (`btn`, `toggle: false`): a click, a long press.
  BUTTON: 'button',
  // A toggle button, a `switch` or a `checkbox`: on/off, both ways.
  SWITCH: 'switch',
  // A `slider` or an `arc` (0-100): a level, both ways.
  SLIDER: 'slider',
  // Any object with a `text` property (`label`, `btn`...): Gladys writes it.
  TEXT: 'text',
};

export const DEFAULT_CONFIG = {
  // mqtt://host:1883, mqtts://host:8883, ws://host:9001...
  mqtt_url: '',
  mqtt_username: '',
  mqtt_password: '',
  // The first level of every openHASP topic (`hasp/<plate>/state/...`).
  topic_prefix: 'hasp',
  // Screen objects exposed as Gladys devices, see parseObjects below.
  objects: '',
};

const MQTT_SCHEMES = ['mqtt:', 'mqtts:', 'ws:', 'wss:', 'tcp:', 'ssl:'];

/**
 * The broker URL as the MQTT client takes it: a bare host or `host:port` gets
 * the `mqtt://` scheme, anything that does not parse is `null`.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function normalizeMqttUrl(raw) {
  const text = String(raw ?? '').trim();
  if (!text) {
    return null;
  }
  const withScheme = /^[a-z]+:\/\//i.test(text) ? text : `mqtt://${text}`;
  try {
    const url = new URL(withScheme);
    if (!MQTT_SCHEMES.includes(url.protocol) || !url.hostname) {
      return null;
    }
    return withScheme;
  } catch {
    return null;
  }
}

/**
 * The broker URL safe to show or log: credentials typed in the URL are hidden.
 * @param {string | null} url
 */
export function redactUrl(url) {
  if (!url) {
    return '';
  }
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = '***';
      parsed.password = '';
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

/** An openHASP plate name, as typed in its MQTT settings (it is also its hostname). */
const PLATE_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
/** An object id: page 0-12, id 0-254 (`p0b1`, `p12b254`). */
const OBJECT_PATTERN = /^p(\d{1,2})b(\d{1,3})$/;

/** Whether `name` can be the name of a plate (and so a topic level). */
export function isPlateName(name) {
  return typeof name === 'string' && PLATE_PATTERN.test(name);
}

/** Whether `id` is a valid object id (`p1b2`). */
export function isObjectId(id) {
  const match = OBJECT_PATTERN.exec(String(id ?? ''));
  return Boolean(match) && Number(match[1]) <= 12 && Number(match[2]) <= 254;
}

/**
 * Parse the `objects` setting: entries separated by commas, semicolons or new
 * lines, each `<plate>.<object>:<type>[:<name>]`, e.g.
 * `plate01.p1b2:switch:Living room light, plate01.p1b3:button:Good night`.
 *
 * Tolerant: a broken entry is skipped and reported, never fatal, so one typo
 * does not take every other object away.
 *
 * @param {unknown} text
 * @returns {{ objects: Array<{ plate: string, object: string, type: string, name: string }>, errors: string[] }}
 */
export function parseObjects(text) {
  const objects = [];
  const errors = [];
  const seen = new Set();
  const entries = String(text ?? '')
    .split(/[\n,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const entry of entries) {
    const [address = '', rawType = '', ...nameParts] = entry.split(':');
    const dot = address.lastIndexOf('.');
    const plate = address.slice(0, dot).trim();
    const object = address
      .slice(dot + 1)
      .trim()
      .toLowerCase();
    const type = rawType.trim().toLowerCase();
    const name = nameParts.join(':').trim();
    if (dot <= 0 || !isPlateName(plate) || !isObjectId(object)) {
      errors.push(`"${entry}": expected <plate>.<object>, e.g. plate01.p1b2`);
      continue;
    }
    if (!Object.values(OBJECT_TYPES).includes(type)) {
      errors.push(`"${entry}": unknown type "${type}"`);
      continue;
    }
    const key = `${plate}.${object}`;
    if (seen.has(key)) {
      errors.push(`"${entry}": ${key} is already declared`);
      continue;
    }
    seen.add(key);
    objects.push({ plate, object, type, name: name || `${plate} ${object}` });
  }
  return { objects, errors };
}

/**
 * The `objects` setting written back from a list (the "Add an object" action).
 * Separators in a name would split the entry: they become spaces.
 * @param {Array<{ plate: string, object: string, type: string, name: string }>} objects
 */
export function formatObjects(objects) {
  return objects
    .map(({ plate, object, type, name }) => {
      const cleanName = String(name ?? '')
        .replace(/[\n,;]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return `${plate}.${object}:${type}${cleanName ? `:${cleanName}` : ''}`;
    })
    .join(', ');
}

/** A topic level typed by the user: no wildcard, no leading/trailing slash. */
function normalizePrefix(raw) {
  const prefix = String(raw ?? '')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  if (!prefix || /[#+]/.test(prefix)) {
    return DEFAULT_CONFIG.topic_prefix;
  }
  return prefix;
}

/**
 * Merge the user config with the defaults and type every value.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const { objects, errors } = parseObjects(raw.objects);
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    mqtt_url: normalizeMqttUrl(raw.mqtt_url),
    mqtt_username: String(raw.mqtt_username ?? '').trim(),
    mqtt_password: String(raw.mqtt_password ?? ''),
    topic_prefix: normalizePrefix(raw.topic_prefix),
    objects: String(raw.objects ?? ''),
    objectList: objects,
    objectErrors: errors,
  };
}
