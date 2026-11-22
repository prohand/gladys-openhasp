# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and to human contributors when
working with code in this repository.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step) for **openHASP**
touch screens ("plates": Lanbon L8, WT32-SC01, Sunton… running the openHASP firmware). It talks
to the plates over **MQTT**, on the local network only (manifest `transports: ["local"]`).
Runtime dependencies: `@gladysassistant/integration-sdk` and `mqtt`. Requires Gladys 5.3+.
Started from the official
[JavaScript template](https://github.com/GladysAssistant/integration-template-js); the
workflows mirror [prohand/gladys-devmel](https://github.com/prohand/gladys-devmel).

## Commands

```bash
npm install
npm test                                    # node --test (built-in runner)
node --test test/app.test.js                # one file
node --test --test-name-pattern "widget"    # tests whose name matches
LOG_LEVEL=silent npm test                   # without the log lines
npm run lint                                # eslint .
npm run format:check                        # prettier --check . (CI gate)
npm run format                              # prettier --write .
npx github:GladysAssistant/integration-store .   # store admission checks
```

CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on Node 22 and 24, and on
pull requests the store checks and a Docker build. Run the three commands before pushing.

## Architecture

```
index.js                     SDK bootstrap only: createApp(new GladysIntegration()), connect
src/app.js                   every Gladys handler + hub events -> states / scene events / widget
src/config.js                DEFAULT_CONFIG (mirrors the manifest), normalization, objects setting
src/i18n.js                  LANGUAGES = en, fr, de, es; pick / localize / message
src/openhasp/broker.js       MQTT connection (mqtt.js), `connect` injectable for the tests
src/openhasp/topics.js       hasp/<plate>/{LWT,state/#,command/#}, hasp/discovery/#, broadcast
src/openhasp/payloads.js     tolerant parsing of what the plates send
src/openhasp/hub.js          plate registry (online, page, backlight, idle, rssi) + orders
src/devices/plate.js         plate device: backlight, brightness, page (text select), awake, signal
src/devices/objects.js       screen object devices: button, switch, slider, text
src/devices/index.js         discovery list, external id -> plate/object, transports
src/capabilities/scenes.js   scene triggers (object_event, plate_status, page_changed) + actions
src/capabilities/widget.js   "plates" dashboard widget
src/capabilities/actions.js  Configuration screen buttons (test, discover, identify, add/list objects)
docs/{en,fr,de,es}.md        user documentation, re-hosted by Gladys (mandatory, kept in sync)
test/                        node --test, SDK fake Gladys + test/helpers/fakeMqtt.js
.github/scripts/changelog-release.mjs   rolls CHANGELOG.md during a release
```

## Invariants worth knowing

- **External ids are forever.** Plates: `plate:<plate name>`; objects:
  `object:<plate name>.<pXbY>`. The plate name (openHASP "Plate Name") is the only thing the
  MQTT topics carry, so it is the platform id: renaming a plate makes a new device. Feature keys
  (`backlight`, `brightness`, `page`, `awake`, `signal`, `click`, `state`, `level`, `text`),
  config keys, action / scene / widget keys are stored by users: never rename them.
- **Every feature carries `name`, `min`, `max`, `read_only`, `has_feedback`** (NOT NULL in
  Gladys). `0`/`0` for text features. The fake Gladys refuses a missing one.
- **No state flood.** Gladys accepts 300 states and 300 scene events a minute. Slider `changed`
  and button `hold` events are never published nor fired; switch/slider/plate states go through
  `publishChangedStates` (deduplicated). Button clicks use `publishState` on purpose: two clicks
  in a row must both reach Gladys.
- **A reading is not a change.** The first page / online status known after a (re)start does not
  fire `page_changed` / `plate_status`.
- **Orders never queue.** `Broker.publish` rejects when the broker is down: an order that cannot
  leave fails now instead of firing minutes later. Scene actions answer `sent: false` instead of
  failing (a scene action is never a condition).
- **Secrets.** `mqtt_password` is a `secret` field. Never log it, nor a broker URL with
  credentials: use `redactUrl`.
- **The container rootfs is read-only.** Nothing is written to disk; only `/data` would be
  writable.
- **Countries.** No `countries` field on purpose: openHASP works worldwide (a test checks it).

## Rules

- **Versions belong to the Release workflow** (Actions → Release). Never edit `version` in
  `package.json` or the manifest, nor the `docker_image` tag, by hand. `test/manifest.test.js`
  checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`). Never write a version
  heading: the Release workflow moves the section and it becomes the GitHub Release notes.
- **Manifest.** Every text is `{ en, fr, de, es }` (labels, descriptions, placeholders). The
  catalog description holds 10 to 100 characters per language. `keywords` needs
  `gladys_version >= 5.3.0`. `test/manifest.test.js` ties the manifest to the code (defaults,
  handlers, trigger options, languages): change both sides together.
- **User-facing text** (action messages, connection status, widget) goes through `src/i18n.js`
  in the four languages; `docs/*.md` are kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why, in English.
  Tests never touch the network: use `createFakeMqtt()` and the SDK's `createFakeGladys()`.
