# openHASP — Gladys Assistant integration

External integration connecting [Gladys Assistant](https://gladysassistant.com) to
**[openHASP](https://www.openhasp.com)** touch screens ("plates": Lanbon L8, WT32-SC01,
Sunton and other ESP32 screens), over MQTT, on the local network.

Built on the official
[JavaScript integration template](https://github.com/GladysAssistant/integration-template-js)
and the SDK
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).
Requires **Gladys 5.3.0 or later**.

User documentation: [English](./docs/en.md) · [Français](./docs/fr.md) ·
[Deutsch](./docs/de.md) · [Español](./docs/es.md).

## What it does

| Gladys device | Features                                                                      |
| ------------- | ----------------------------------------------------------------------------- |
| Plate         | backlight on/off, brightness (0-100 %), page shown (list), screen awake, WiFi |
| `button`      | click, long press, long press released (read only)                            |
| `switch`      | on/off, both ways (toggle `btn`, `switch`, `checkbox`)                        |
| `slider`      | level 0-100, both ways (`slider`, `arc`)                                      |
| `text`        | text written by Gladys on a `label` or a `btn`                                |

Plates are found on the broker by themselves (their `LWT` and `discovery` messages). Screen
objects are declared in the configuration (`plate01.p1b2:switch:Living room light, …`) or with
the **Add an object** button.

Gladys 5.1+ capabilities (`src/capabilities/`):

| Capability     | Keys                                                                            |
| -------------- | ------------------------------------------------------------------------------- |
| Scene triggers | `object_event`, `plate_status`, `page_changed`                                  |
| Scene actions  | `show_page`, `set_object_text`, `set_backlight`, `wake_screen`, `send_command`  |
| Widget         | `plates`: plates online, page shown, **Wake screens** / **Find plates** buttons |
| Actions        | `test_connection`, `discover_plates`, `identify`, `add_object`, `list_objects`  |

Transport: **local** only. Each device's badge is `local` while its plate is online and the
broker connected, `unreachable` otherwise. No `countries` field: usable worldwide.

## How it talks to the plates

```
hasp/<plate>/LWT              online / offline           -> plate online, badge, plate_status
hasp/discovery/<hwid>         model, firmware, pages      -> plate device, page list
hasp/<plate>/state/page       page shown                  -> page feature, page_changed
hasp/<plate>/state/backlight  {"state":"on","brightness"} -> backlight + brightness
hasp/<plate>/state/idle       off / short / long          -> screen awake
hasp/<plate>/state/statusupdate  rssi, ip, version        -> WiFi signal
hasp/<plate>/state/p1b2       {"event":"up","val":1}      -> object states, object_event
hasp/<plate>/command/...      page, backlight, idle, p1b2.val, p1b2.text, raw commands
hasp/broadcast/command/discovery  sent on connection and on "Search for plates"
```

The prefix (`hasp`) is configurable. The broker can be the one of the Gladys MQTT integration.

## Project structure

```
.
├─ index.js                          # SDK bootstrap (createApp + connect)
├─ src/
│  ├─ app.js                         # Gladys handlers + plate events wiring
│  ├─ config.js                      # defaults, broker URL, objects setting
│  ├─ i18n.js                        # en / fr / de / es helpers
│  ├─ openhasp/                      # MQTT: broker, topics, payloads, plate hub
│  ├─ devices/                       # plate and screen object devices
│  └─ capabilities/                  # scenes, widget, Configuration actions
├─ docs/                             # user documentation (en, fr, de, es)
├─ test/                             # node --test, fake Gladys + fake MQTT broker
├─ gladys-assistant-integration.json # manifest
├─ Dockerfile                        # Node 24 Alpine, read-only rootfs, non-root
├─ CHANGELOG.md                      # Keep a Changelog, rolled by the Release workflow
├─ CLAUDE.md                         # project rules for coding assistants & contributors
├─ SECURITY.md                       # how to report a vulnerability privately
├─ .github/workflows/ci.yml          # format, lint, tests (Node 22 + 24), store checks, Docker build
├─ .github/workflows/release.yml     # UI-driven release: bump + changelog + tag + build + store check
├─ .github/workflows/build.yml       # multi-arch build (git tag, manual run or called by release)
├─ .github/workflows/github-release.yml # GitHub Release of every version tag
├─ .github/scripts/changelog-release.mjs # changelog roll used by the release
├─ .github/dependabot.yml            # weekly npm, monthly Actions and Docker updates
└─ cover.png                         # catalog cover, 800×534 px
```

## Run it locally

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="openhasp" \
LOG_LEVEL=debug \
npm start
```

The three `GLADYS_*` variables are injected by the Gladys supervisor when the integration runs
in its container. The broker address and credentials come from the Configuration screen.

## Quality checks

```bash
npm run format:check   # Prettier
npm run lint           # ESLint
npm test               # node --test: fake Gladys (SDK) + fake MQTT broker, no network
```

The same checks run on every push and pull request (Node 22 and 24), with the store admission
checks and a Docker build on pull requests.

## Release

1. Describe the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md).
2. **Actions → Release → Run workflow**, pick `patch`, `minor` or `major` (the first release:
   `major`, which gives `1.0.0`).
3. The workflow bumps `package.json`, `package-lock.json` and the manifest (`version` +
   `docker_image`), rolls the changelog, tags `vX.Y.Z`, builds the `linux/amd64` + `linux/arm64`
   image to `ghcr.io/prohand/gladys-openhasp`, publishes the GitHub Release and runs the store
   checks, image included.

Before the first release: add the GitHub topic `gladys-assistant-integration` to the
repository, make the package `ghcr.io/prohand/gladys-openhasp` public after the first build,
and turn on **Private vulnerability reporting** (see [`SECURITY.md`](SECURITY.md)).

## License

Apache-2.0
