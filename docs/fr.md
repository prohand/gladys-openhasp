# openHASP pour Gladys Assistant

Cette intégration relie Gladys à vos écrans tactiles **openHASP** (« plates ») :
Lanbon L8, WT32-SC01, Sunton et tous les écrans ESP32 qui tournent avec le
firmware [openHASP](https://www.openhasp.com).

- Chaque écran devient un appareil Gladys : rétroéclairage, luminosité, page
  affichée, écran actif, signal WiFi.
- Les boutons, interrupteurs, curseurs et textes de vos pages peuvent aussi
  devenir des appareils Gladys.
- Les scènes peuvent réagir à un appui, à un changement de page ou à un écran
  hors ligne, et peuvent afficher une page, écrire un texte, réveiller un écran
  ou envoyer n'importe quelle commande openHASP.
- Un widget de tableau de bord liste vos écrans.

Nécessite **Gladys 5.3 ou plus récent**.

## Ce qu'il vous faut

- Un ou plusieurs écrans flashés avec openHASP **0.6 ou plus récent**.
- Un **broker MQTT** joignable par les écrans et par Gladys. Le broker de
  l'intégration MQTT de Gladys convient (Mosquitto, port 1883), tout autre
  aussi.

Tout reste sur votre réseau local : pas de compte, pas de cloud.

## 1. Reliez vos écrans au broker

Sur chaque écran, ouvrez sa page web (`http://<IP de l'écran>`), puis
**Configuration → MQTT Settings** :

| Réglage openHASP | Quoi saisir                                        |
| ---------------- | -------------------------------------------------- |
| Plate Name       | un nom court et unique, ex. `plate01` ou `cuisine` |
| Group Name       | gardez `plates`                                    |
| Broker           | l'adresse IP de votre broker                       |
| Port             | `1883` (en général)                                |
| Username         | l'utilisateur du broker, s'il en demande un        |
| Password         | son mot de passe                                   |

Enregistrez et redémarrez l'écran. Le **Plate Name** est ce qui identifie
l'écran dans Gladys : le renommer plus tard crée un nouvel appareil.

## 2. Configurez l'intégration

Dans Gladys, ouvrez **Intégrations → openHASP → Configuration** :

| Champ                  | Quoi saisir                                                              |
| ---------------------- | ------------------------------------------------------------------------ |
| Adresse du broker MQTT | `mqtt://192.168.1.10:1883` (`mqtts://` pour TLS, `ws://` pour WebSocket) |
| Utilisateur MQTT       | l'utilisateur du broker, vide pour un broker anonyme                     |
| Mot de passe MQTT      | son mot de passe                                                         |
| Préfixe des topics     | gardez `hasp`, sauf si vous l'avez changé dans le firmware openHASP      |
| Objets d'écran         | les objets à piloter, voir plus bas (peut rester vide)                   |

Enregistrez, puis cliquez sur **Tester la connexion** : l'intégration se
reconnecte au broker et liste les écrans qui ont répondu.

L'état de la connexion, en haut de la page, indique quand le broker est
injoignable (mauvaise adresse, mauvais mot de passe…).

## 3. Ajoutez les écrans

Ouvrez l'onglet **Découverte** : chaque écran vu sur le broker apparaît sous le
nom `openHASP <nom de l'écran>`. Cliquez sur **Ajouter**. Un écran n'apparaît
pas ? Cliquez sur **Rechercher les écrans** dans l'onglet Configuration, et
vérifiez ses réglages MQTT.

Chaque écran a ces fonctions :

| Fonction                   | Rôle                                                          |
| -------------------------- | ------------------------------------------------------------- |
| Rétroéclairage (Backlight) | allume ou éteint le rétroéclairage                            |
| Luminosité (Brightness)    | niveau du rétroéclairage, 0-100 % (0 l'éteint)                |
| Page                       | la page affichée ; choisissez-en une autre pour y aller       |
| Écran actif (Screen awake) | allumé = utilisé ; éteint = en veille. Allumez pour réveiller |
| Signal WiFi (WiFi signal)  | de 0 à 5 barres                                               |

**Identifier un écran** (onglet Configuration) fait clignoter trois fois
l'écran choisi, pour savoir lequel est lequel.

## 4. Pilotez les objets de vos pages

Un objet openHASP se nomme par sa page et son id : `p1b2` est l'objet `2` de
la page `1`. Les ids sont dans votre fichier `pages.jsonl`.

Listez les objets à piloter dans **Objets d'écran**, séparés par des virgules :

```
plate01.p1b2:switch:Lampe du salon, plate01.p1b3:button:Bonne nuit, plate01.p2b1:text:Message
```

Chaque entrée s'écrit `<nom de l'écran>.<objet>:<type>:<nom dans Gladys>`.
Les types :

| Type     | Objets openHASP                                 | Dans Gladys                                                                |
| -------- | ----------------------------------------------- | -------------------------------------------------------------------------- |
| `button` | `btn` (bouton normal)                           | un bouton : clic, appui long, appui long relâché (lecture seule)           |
| `switch` | `btn` avec `toggle: true`, `switch`, `checkbox` | marche/arrêt, dans les deux sens : l'écran met Gladys à jour, et l'inverse |
| `slider` | `slider`, `arc` (plage 0-100)                   | un niveau 0-100, dans les deux sens                                        |
| `text`   | `label`, le texte d'un `btn`                    | un texte que Gladys écrit sur l'écran                                      |

Plus simple : le bouton **Ajouter un objet** (onglet Configuration) demande
l'écran, l'objet, le type et le nom, et écrit l'entrée pour vous. Pas sûr d'un
id ? Touchez l'objet sur l'écran, puis cliquez sur **Lister les objets
touchés** : il liste les ids signalés par les écrans et pas encore déclarés.

Ajoutez ensuite les nouveaux appareils depuis l'onglet **Découverte**.

> Un curseur n'envoie sa valeur qu'une fois relâché : le faire glisser ne
> noie pas Gladys sous les valeurs.

## Scènes

### Déclencheurs

| Déclencheur (clé)                                      | Quand                                       | Filtres                             | Variables                  |
| ------------------------------------------------------ | ------------------------------------------- | ----------------------------------- | -------------------------- |
| Objet openHASP touché (`object_event`)                 | un objet est appuyé ou relâché              | écran, objet (`p1b2`), type d'appui | object, event, value, text |
| Écran openHASP en ligne ou hors ligne (`plate_status`) | un écran se connecte au broker ou le quitte | écran, état                         | status                     |
| Page openHASP changée (`page_changed`)                 | un écran affiche une autre page             | écran, page                         | page                       |

Les types d'appui : **Appuyé** (`down`), **Appui court relâché** (`up`),
**Appui long** (`long`), **Appui long relâché** (`release`). Tout objet de
toute page déclenche `object_event`, déclaré dans Objets d'écran ou non :
inutile de déclarer un bouton qui ne sert qu'aux scènes.

Exemple : un bouton « Bonne nuit » en `p1b3` → déclencheur _Objet openHASP
touché_, écran `openHASP plate01`, objet `p1b3`, appui _Appui court relâché_ →
éteindre les lumières.

### Actions

Chaque action renvoie une variable **sent** (envoyé) : `false` quand l'écran
est hors ligne ou que le broker est injoignable (la scène continue ; ajoutez
une condition dessus si besoin).

| Action (clé)                                        | Rôle                                                                          |
| --------------------------------------------------- | ----------------------------------------------------------------------------- |
| Afficher une page openHASP (`show_page`)            | affiche la page 1-12 sur l'écran                                              |
| Écrire sur un objet openHASP (`set_object_text`)    | change le texte d'une étiquette ou d'un bouton ; les variables marchent       |
| Régler le rétroéclairage openHASP (`set_backlight`) | allumé ou éteint, avec une luminosité 1-255 en option                         |
| Réveiller un écran openHASP (`wake_screen`)         | comme un toucher : relance la mise en veille (pratique avec un détecteur)     |
| Envoyer une commande openHASP (`send_command`)      | n'importe quelle commande openHASP, ex. `p1b2.bg_color=red` ou `moodlight on` |

Exemple : afficher la température extérieure sur une étiquette → action
_Écrire sur un objet openHASP_, objet `p1b5`, texte `{{device.temperature}} °C`
(choisissez la variable dans l'éditeur).

## Widget de tableau de bord

Le widget **Écrans openHASP** affiche le nombre d'écrans en ligne, une ligne
par écran (en ligne avec sa page, hors ligne) et deux boutons : **Réveiller**
et **Chercher**.

## En cas de problème

- **« Pas connecté au broker MQTT »** : vérifiez l'adresse et le port, et
  l'utilisateur et le mot de passe si le broker en demande. Avec le broker de
  l'intégration MQTT de Gladys, utilisez l'adresse IP de la machine Gladys,
  pas `localhost`.
- **Aucun écran dans l'onglet Découverte** : l'écran et Gladys doivent utiliser
  le même broker et le même préfixe de topics. Un outil comme MQTT Explorer
  montre le topic `hasp/<écran>/LWT` de chaque écran connecté.
- **Un objet ne réagit pas** : vérifiez son id (`p1b2`), son type, et que son
  appareil a été ajouté depuis l'onglet Découverte.
- **Logs** : Intégrations → openHASP → Supervision. Les mots de passe ne sont
  jamais écrits dans les logs.

## Vie privée et sécurité

L'intégration ne parle qu'à votre broker MQTT, sur votre réseau. Le mot de
passe MQTT est stocké dans un champ secret de Gladys. Signalez un problème de
sécurité en privé : voir le fichier `SECURITY.md` du dépôt.
