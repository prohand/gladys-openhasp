# openHASP para Gladys Assistant

Esta integración conecta Gladys con sus pantallas táctiles **openHASP**
(«plates»): Lanbon L8, WT32-SC01, Sunton y cualquier otra pantalla ESP32 con el
firmware [openHASP](https://www.openhasp.com).

- Cada pantalla se convierte en un dispositivo Gladys: retroiluminación,
  brillo, página mostrada, pantalla activa, señal WiFi.
- Los botones, interruptores, deslizadores y textos de sus páginas también
  pueden convertirse en dispositivos Gladys.
- Las escenas pueden reaccionar a un toque, a un cambio de página o a una
  pantalla que se desconecta, y pueden mostrar una página, escribir un texto,
  despertar una pantalla o enviar cualquier comando openHASP.
- Un widget del panel lista sus pantallas.

Requiere **Gladys 5.3 o posterior**.

## Lo que necesita

- Una o varias pantallas con openHASP **0.6 o posterior**.
- Un **broker MQTT** accesible por las pantallas y por Gladys. Sirve el broker
  de la integración MQTT de Gladys (Mosquitto, puerto 1883) o cualquier otro.

Todo se queda en su red local: sin cuenta, sin nube.

## 1. Conecte sus pantallas al broker

En cada pantalla, abra su página web (`http://<IP de la pantalla>`) y luego
**Configuration → MQTT Settings**:

| Ajuste openHASP | Qué escribir                                         |
| --------------- | ---------------------------------------------------- |
| Plate Name      | un nombre corto y único, p. ej. `plate01` o `cocina` |
| Group Name      | deje `plates`                                        |
| Broker          | la dirección IP de su broker                         |
| Port            | `1883` (normalmente)                                 |
| Username        | el usuario del broker, si lo pide                    |
| Password        | su contraseña                                        |

Guarde y reinicie la pantalla. El **Plate Name** es lo que identifica la
pantalla en Gladys: cambiarlo más tarde crea un dispositivo nuevo.

## 2. Configure la integración

En Gladys, abra **Integraciones → openHASP → Configuración**:

| Campo                     | Qué escribir                                                             |
| ------------------------- | ------------------------------------------------------------------------ |
| Dirección del broker MQTT | `mqtt://192.168.1.10:1883` (`mqtts://` para TLS, `ws://` para WebSocket) |
| Usuario MQTT              | el usuario del broker, vacío para un broker anónimo                      |
| Contraseña MQTT           | su contraseña                                                            |
| Prefijo de los topics     | deje `hasp`, salvo que lo haya cambiado en el firmware openHASP          |
| Objetos de pantalla       | los objetos que controlar, ver más abajo (puede quedar vacío)            |

Guarde y haga clic en **Probar la conexión**: la integración se vuelve a
conectar al broker y lista las pantallas que han respondido.

El estado de la conexión, arriba de la página, avisa cuando no se puede llegar
al broker (dirección o contraseña incorrecta…).

## 3. Añada las pantallas

Abra la pestaña **Descubrimiento**: cada pantalla vista en el broker aparece
como `openHASP <nombre de la pantalla>`. Haga clic en **Añadir**. ¿Falta una
pantalla? Haga clic en **Buscar pantallas** en la pestaña Configuración y
revise sus ajustes MQTT.

Cada pantalla tiene estas funciones:

| Función                        | Qué hace                                                             |
| ------------------------------ | -------------------------------------------------------------------- |
| Retroiluminación (Backlight)   | enciende o apaga la retroiluminación                                 |
| Brillo (Brightness)            | nivel de la retroiluminación, 0-100 % (0 la apaga)                   |
| Página (Page)                  | la página mostrada; elija otra para cambiar a ella                   |
| Pantalla activa (Screen awake) | encendida = en uso; apagada = en reposo. Enciéndala para despertarla |
| Señal WiFi (WiFi signal)       | de 0 a 5 barras                                                      |

**Identificar una pantalla** (pestaña Configuración) hace parpadear tres veces
la pantalla elegida, para saber cuál es cuál.

## 4. Controle los objetos de sus páginas

Un objeto openHASP se nombra por su página y su id: `p1b2` es el objeto `2` de
la página `1`. Los ids están en su archivo `pages.jsonl`.

Indique los objetos que controlar en **Objetos de pantalla**, separados por
comas:

```
plate01.p1b2:switch:Luz del salón, plate01.p1b3:button:Buenas noches, plate01.p2b1:text:Mensaje
```

Cada entrada es `<nombre de la pantalla>.<objeto>:<tipo>:<nombre en Gladys>`.
Los tipos:

| Tipo     | Objetos openHASP                               | En Gladys                                                                    |
| -------- | ---------------------------------------------- | ---------------------------------------------------------------------------- |
| `button` | `btn` (botón normal)                           | un botón: clic, pulsación larga, pulsación larga soltada (solo lectura)      |
| `switch` | `btn` con `toggle: true`, `switch`, `checkbox` | encendido/apagado en ambos sentidos: la pantalla actualiza Gladys y al revés |
| `slider` | `slider`, `arc` (rango 0-100)                  | un nivel 0-100, en ambos sentidos                                            |
| `text`   | `label`, el texto de un `btn`                  | un texto que Gladys escribe en la pantalla                                   |

Más fácil: el botón **Añadir un objeto** (pestaña Configuración) pide la
pantalla, el objeto, el tipo y el nombre, y escribe la entrada por usted. ¿No
está seguro de un id? Toque el objeto en la pantalla y haga clic en **Listar
los objetos tocados**: muestra los ids que las pantallas han enviado y que aún
no están declarados.

Después añada los nuevos dispositivos desde la pestaña **Descubrimiento**.

> Un deslizador solo envía su valor al soltarlo: arrastrarlo no inunda Gladys
> de valores.

## Escenas

### Disparadores

| Disparador (clave)                                         | Cuándo                                      | Filtros                                  | Variables                  |
| ---------------------------------------------------------- | ------------------------------------------- | ---------------------------------------- | -------------------------- |
| Objeto openHASP tocado (`object_event`)                    | se pulsa o se suelta un objeto              | pantalla, objeto (`p1b2`), tipo de toque | object, event, value, text |
| Pantalla openHASP en línea o sin conexión (`plate_status`) | una pantalla se conecta al broker o lo deja | pantalla, estado                         | status                     |
| Página openHASP cambiada (`page_changed`)                  | una pantalla muestra otra página            | pantalla, página                         | page                       |

Los tipos de toque: **Pulsado** (`down`), **Pulsación corta soltada** (`up`),
**Pulsación larga** (`long`), **Pulsación larga soltada** (`release`).
Cualquier objeto de cualquier página dispara `object_event`, esté declarado en
Objetos de pantalla o no: no hace falta declarar un botón que solo sirve para
escenas.

Ejemplo: un botón «Buenas noches» en `p1b3` → disparador _Objeto openHASP
tocado_, pantalla `openHASP plate01`, objeto `p1b3`, toque _Pulsación corta
soltada_ → apagar las luces.

### Acciones

Cada acción devuelve una variable **sent** (enviado): `false` cuando la
pantalla está desconectada o el broker no responde (la escena continúa; añada
una condición sobre ella si hace falta).

| Acción (clave)                                         | Qué hace                                                                      |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Mostrar una página openHASP (`show_page`)              | cambia la pantalla a la página 1-12                                           |
| Escribir en un objeto openHASP (`set_object_text`)     | cambia el texto de una etiqueta o un botón; las variables de escena funcionan |
| Ajustar la retroiluminación openHASP (`set_backlight`) | encendida o apagada, con un brillo opcional 1-255                             |
| Despertar una pantalla openHASP (`wake_screen`)        | como un toque: reinicia el reposo (útil con un detector de movimiento)        |
| Enviar un comando openHASP (`send_command`)            | cualquier comando openHASP, p. ej. `p1b2.bg_color=red` o `moodlight on`       |

Ejemplo: mostrar la temperatura exterior en una etiqueta → acción _Escribir en
un objeto openHASP_, objeto `p1b5`, texto `{{device.temperature}} °C` (elija
la variable en el editor).

## Widget del panel

El widget **Pantallas openHASP** muestra cuántas pantallas están en línea, una
línea por pantalla (en línea con su página, sin conexión) y dos botones:
**Despertar** y **Buscar**.

## Solución de problemas

- **«Sin conexión con el broker MQTT»**: revise la dirección y el puerto, y el
  usuario y la contraseña si el broker los pide. Con el broker de la
  integración MQTT de Gladys, use la dirección IP de la máquina Gladys, no
  `localhost`.
- **Ninguna pantalla en la pestaña Descubrimiento**: la pantalla y Gladys deben
  usar el mismo broker y el mismo prefijo de topics. Una herramienta como MQTT
  Explorer muestra el topic `hasp/<pantalla>/LWT` de cada pantalla conectada.
- **Un objeto no reacciona**: revise su id (`p1b2`), su tipo y que su
  dispositivo se haya añadido desde la pestaña Descubrimiento.
- **Registros**: Integraciones → openHASP → Supervisión. Las contraseñas nunca
  se escriben en los registros.

## Privacidad y seguridad

La integración solo habla con su broker MQTT, en su red. La contraseña MQTT se
guarda en un campo secreto de Gladys. Informe de un problema de seguridad en
privado: vea el archivo `SECURITY.md` del repositorio.
