// -----------------------------------------------------------------------------
// openHASP MQTT topics.
//
//   <prefix>/<plate>/LWT              online | offline (retained, set by the plate)
//   <prefix>/<plate>/state/<key>      what the plate reports (page, backlight, p1b2...)
//   <prefix>/<plate>/command/<key>    what we ask it (page 2, p1b2.text Hello...)
//   <prefix>/discovery/<hwid>         who the plate is (model, pages, firmware)
//   <prefix>/broadcast/command/<key>  a command every plate obeys
//
// See https://www.openhasp.com/latest/commands/mqtt/
// -----------------------------------------------------------------------------

/**
 * Topic levels that are not plates: the broadcast and discovery channels, and
 * `plates`, the default group name every plate also listens to.
 */
const RESERVED_LEVELS = new Set(['broadcast', 'discovery', 'plates']);

/**
 * The topics of one prefix.
 * @param {string} prefix the first topic level, `hasp` by default
 */
export function topicsFor(prefix) {
  return {
    prefix,
    /** Everything the integration listens to. */
    subscriptions: [`${prefix}/+/LWT`, `${prefix}/+/state/#`, `${prefix}/discovery/#`],

    /** `<prefix>/<plate>/command[/<keyword>]` */
    command(plate, keyword) {
      return keyword ? `${prefix}/${plate}/command/${keyword}` : `${prefix}/${plate}/command`;
    },

    /** `<prefix>/broadcast/command/<keyword>` */
    broadcast(keyword) {
      return `${prefix}/broadcast/command/${keyword}`;
    },

    /**
     * What a received topic is about, or `null` for a topic that is not ours.
     * @param {string} topic
     * @returns {{ kind: 'lwt', plate: string } | { kind: 'state', plate: string, key: string } | { kind: 'discovery', id: string } | null}
     */
    parse(topic) {
      const levels = String(topic).split('/');
      if (levels[0] !== prefix) {
        return null;
      }
      if (levels[1] === 'discovery' && levels.length >= 3) {
        return { kind: 'discovery', id: levels.slice(2).join('/') };
      }
      const plate = levels[1];
      if (!plate || RESERVED_LEVELS.has(plate)) {
        return null;
      }
      if (levels.length === 3 && levels[2] === 'LWT') {
        return { kind: 'lwt', plate };
      }
      if (levels.length >= 4 && levels[2] === 'state') {
        return { kind: 'state', plate, key: levels.slice(3).join('/') };
      }
      return null;
    },
  };
}
