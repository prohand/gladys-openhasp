# openHASP für Gladys Assistant

Diese Integration verbindet Gladys mit deinen **openHASP**-Touchdisplays
(„Plates“): Lanbon L8, WT32-SC01, Sunton und jedes andere ESP32-Display mit der
Firmware [openHASP](https://www.openhasp.com).

- Jedes Display wird ein Gladys-Gerät: Beleuchtung, Helligkeit, angezeigte
  Seite, Display aktiv, WLAN-Signal.
- Die Tasten, Schalter, Schieberegler und Texte deiner Seiten können ebenfalls
  Gladys-Geräte werden.
- Szenen können auf eine Berührung, einen Seitenwechsel oder ein Display, das
  offline geht, reagieren und eine Seite anzeigen, einen Text schreiben, ein
  Display aufwecken oder einen beliebigen openHASP-Befehl senden.
- Ein Dashboard-Widget listet deine Displays auf.

Benötigt **Gladys 5.3 oder neuer**.

## Was du brauchst

- Ein oder mehrere Displays mit openHASP **0.6 oder neuer**.
- Einen **MQTT-Broker**, den die Displays und Gladys erreichen. Der Broker der
  Gladys-MQTT-Integration funktioniert (Mosquitto, Port 1883), jeder andere
  auch.

Alles bleibt in deinem lokalen Netzwerk: kein Konto, keine Cloud.

## 1. Verbinde deine Displays mit dem Broker

Öffne auf jedem Display seine Webseite (`http://<IP des Displays>`), dann
**Configuration → MQTT Settings**:

| openHASP-Einstellung | Was du einträgst                                            |
| -------------------- | ----------------------------------------------------------- |
| Plate Name           | ein kurzer, eindeutiger Name, z. B. `plate01` oder `kueche` |
| Group Name           | `plates` beibehalten                                        |
| Broker               | die IP-Adresse deines Brokers                               |
| Port                 | `1883` (meistens)                                           |
| Username             | der Broker-Benutzer, falls nötig                            |
| Password             | sein Passwort                                               |

Speichern und das Display neu starten. Am **Plate Name** erkennt Gladys das
Display: Ein späteres Umbenennen erzeugt ein neues Gerät.

## 2. Richte die Integration ein

Öffne in Gladys **Integrationen → openHASP → Konfiguration**:

| Feld                     | Was du einträgst                                                       |
| ------------------------ | ---------------------------------------------------------------------- |
| Adresse des MQTT-Brokers | `mqtt://192.168.1.10:1883` (`mqtts://` für TLS, `ws://` für WebSocket) |
| MQTT-Benutzername        | der Broker-Benutzer, leer bei einem anonymen Broker                    |
| MQTT-Passwort            | sein Passwort                                                          |
| Topic-Präfix             | `hasp` beibehalten, außer du hast es in der openHASP-Firmware geändert |
| Bildschirmobjekte        | die zu steuernden Objekte, siehe unten (darf leer bleiben)             |

Speichern, dann auf **Verbindung testen** klicken: Die Integration verbindet
sich neu mit dem Broker und listet die Displays auf, die geantwortet haben.

Der Verbindungsstatus oben auf der Seite zeigt, wenn der Broker nicht
erreichbar ist (falsche Adresse, falsches Passwort…).

## 3. Füge die Displays hinzu

Öffne den Tab **Erkennung**: Jedes am Broker gesehene Display erscheint als
`openHASP <Name des Displays>`. Klicke auf **Hinzufügen**. Ein Display fehlt?
Klicke im Tab Konfiguration auf **Displays suchen** und prüfe seine
MQTT-Einstellungen.

Jedes Display bietet diese Funktionen:

| Funktion                     | Was sie tut                                                     |
| ---------------------------- | --------------------------------------------------------------- |
| Beleuchtung (Backlight)      | schaltet die Hintergrundbeleuchtung ein oder aus                |
| Helligkeit (Brightness)      | Stufe der Beleuchtung, 0-100 % (0 schaltet sie aus)             |
| Seite (Page)                 | die angezeigte Seite; wähle eine andere, um dorthin zu wechseln |
| Display aktiv (Screen awake) | an = in Benutzung; aus = Ruhezustand. Einschalten weckt es auf  |
| WLAN-Signal (WiFi signal)    | 0 bis 5 Balken                                                  |

**Display identifizieren** (Tab Konfiguration) lässt das gewählte Display
dreimal blinken, damit du weißt, welches welches ist.

## 4. Steuere die Objekte deiner Seiten

Ein openHASP-Objekt wird über Seite und ID benannt: `p1b2` ist Objekt `2` auf
Seite `1`. Die IDs stehen in deiner Datei `pages.jsonl`.

Trage die zu steuernden Objekte unter **Bildschirmobjekte** ein, durch Kommas
getrennt:

```
plate01.p1b2:switch:Wohnzimmerlampe, plate01.p1b3:button:Gute Nacht, plate01.p2b1:text:Nachricht
```

Jeder Eintrag lautet `<Name des Displays>.<Objekt>:<Typ>:<Name in Gladys>`.
Die Typen:

| Typ      | openHASP-Objekte                               | In Gladys                                                                 |
| -------- | ---------------------------------------------- | ------------------------------------------------------------------------- |
| `button` | `btn` (normale Taste)                          | eine Taste: Klick, langer Druck, langer Druck losgelassen (nur lesen)     |
| `switch` | `btn` mit `toggle: true`, `switch`, `checkbox` | an/aus in beide Richtungen: das Display aktualisiert Gladys und umgekehrt |
| `slider` | `slider`, `arc` (Bereich 0-100)                | eine Stufe 0-100, in beide Richtungen                                     |
| `text`   | `label`, der Text eines `btn`                  | ein Text, den Gladys auf das Display schreibt                             |

Einfacher: Die Schaltfläche **Objekt hinzufügen** (Tab Konfiguration) fragt
nach Display, Objekt, Typ und Name und schreibt den Eintrag für dich. Bei einer
ID unsicher? Berühre das Objekt auf dem Display und klicke dann auf
**Berührte Objekte auflisten**: Es listet die gemeldeten, noch nicht
angelegten IDs auf.

Füge die neuen Geräte danach im Tab **Erkennung** hinzu.

> Ein Schieberegler meldet seinen Wert erst beim Loslassen: Das Ziehen
> überflutet Gladys nicht mit Werten.

## Szenen

### Auslöser

| Auslöser (Schlüssel)                                  | Wann                                                        | Filter                                      | Variablen                  |
| ----------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------- | -------------------------- |
| openHASP-Objekt berührt (`object_event`)              | ein Objekt wird gedrückt oder losgelassen                   | Display, Objekt (`p1b2`), Art der Berührung | object, event, value, text |
| openHASP-Display online oder offline (`plate_status`) | ein Display verbindet sich mit dem Broker oder verlässt ihn | Display, Status                             | status                     |
| openHASP-Seite gewechselt (`page_changed`)            | ein Display zeigt eine andere Seite                         | Display, Seite                              | page                       |

Die Arten der Berührung: **Gedrückt** (`down`), **Kurzer Druck losgelassen**
(`up`), **Langer Druck** (`long`), **Langer Druck losgelassen** (`release`).
Jedes Objekt jeder Seite löst `object_event` aus, ob unter
Bildschirmobjekte angelegt oder nicht: Eine Taste, die nur für Szenen dient,
muss nicht angelegt werden.

Beispiel: eine Taste „Gute Nacht“ auf `p1b3` → Auslöser _openHASP-Objekt
berührt_, Display `openHASP plate01`, Objekt `p1b3`, Berührung _Kurzer Druck
losgelassen_ → Lichter ausschalten.

### Aktionen

Jede Aktion liefert eine Variable **sent** (gesendet): `false`, wenn das
Display offline oder der Broker nicht erreichbar ist (die Szene läuft weiter;
setze bei Bedarf eine Bedingung darauf).

| Aktion (Schlüssel)                                    | Was sie tut                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| openHASP-Seite anzeigen (`show_page`)                 | wechselt das Display auf Seite 1-12                                             |
| Auf ein openHASP-Objekt schreiben (`set_object_text`) | ändert den Text eines Labels oder einer Taste; Szenenvariablen funktionieren    |
| openHASP-Beleuchtung einstellen (`set_backlight`)     | an oder aus, optional mit Helligkeit 1-255                                      |
| openHASP-Display aufwecken (`wake_screen`)            | wie eine Berührung: setzt den Ruhe-Timer zurück (praktisch mit Bewegungsmelder) |
| openHASP-Befehl senden (`send_command`)               | ein beliebiger openHASP-Befehl, z. B. `p1b2.bg_color=red` oder `moodlight on`   |

Beispiel: die Außentemperatur auf einem Label anzeigen → Aktion _Auf ein
openHASP-Objekt schreiben_, Objekt `p1b5`, Text `{{device.temperature}} °C`
(wähle die Variable im Editor).

## Dashboard-Widget

Das Widget **openHASP-Displays** zeigt, wie viele Displays online sind, eine
Zeile pro Display (online mit Seite, offline) und zwei Schaltflächen:
**Aufwecken** und **Suchen**.

## Fehlerbehebung

- **„Nicht mit dem MQTT-Broker verbunden“**: Prüfe Adresse und Port sowie
  Benutzer und Passwort, falls der Broker sie verlangt. Mit dem Broker der
  Gladys-MQTT-Integration die IP-Adresse des Gladys-Rechners verwenden, nicht
  `localhost`.
- **Kein Display im Tab Erkennung**: Display und Gladys müssen denselben
  Broker und dasselbe Topic-Präfix nutzen. Ein Werkzeug wie MQTT Explorer
  zeigt das Topic `hasp/<Display>/LWT` jedes verbundenen Displays.
- **Ein Objekt reagiert nicht**: Prüfe seine ID (`p1b2`), seinen Typ und ob
  sein Gerät im Tab Erkennung hinzugefügt wurde.
- **Logs**: Integrationen → openHASP → Überwachung. Passwörter werden nie
  protokolliert.

## Datenschutz und Sicherheit

Die Integration spricht nur mit deinem MQTT-Broker in deinem Netzwerk. Das
MQTT-Passwort wird in einem geheimen Feld von Gladys gespeichert. Melde ein
Sicherheitsproblem vertraulich: siehe die Datei `SECURITY.md` des Repositorys.
