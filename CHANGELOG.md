# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

## [Unreleased]

### Added

- First version of the openHASP integration for Gladys Assistant (Gladys 5.3+), over MQTT, local
  only.
- Plates found on the broker (LWT and discovery), each a device: backlight, brightness, page
  shown, screen awake, WiFi signal; transport badge `local` / `unreachable`.
- Screen objects declared in the configuration (`button`, `switch`, `slider`, `text`), or with
  the **Add an object** action; **List the objects touched** to find their ids.
- Scene triggers: object touched, plate online or offline, page changed.
- Scene actions: show a page, write on an object, set the backlight, wake a screen, send any
  openHASP command.
- "openHASP plates" dashboard widget, with **Wake screens** and **Find plates** buttons.
- Configuration actions: **Test the connection**, **Search for plates**, **Identify a plate**.
- English, French, German and Spanish texts and documentation.

[Unreleased]: https://github.com/prohand/gladys-openhasp/commits/main
