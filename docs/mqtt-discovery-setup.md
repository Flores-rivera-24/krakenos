# MQTT Discovery: los cacharros liberados, sin adaptador por marca (US-248)

`IOT_KIND=mqtt` no es una integración de una marca: es la **puerta abierta**. KrakenOS escucha el
namespace de anuncio de un broker MQTT de tu casa y da de alta **lo que publique cualquier aparato
que hable esa convención**. Si tu cacharro la habla, funciona el día uno, sin esperar a que alguien
escriba su adaptador.

Publican en ese formato, entre otros:

| Firmware / puente | Qué aporta |
|---|---|
| **ESPHome** | Cualquier ESP32/ESP8266 con firmware propio: relés, sensores, persianas |
| **Tasmota** | El destino habitual de un enchufe Tuya/Sonoff liberado |
| **OpenBeken** | Lo mismo para los chips BK7231 (mucho enchufe barato de 2023 en adelante) |
| **Z-Wave JS UI** | Toda tu red Z-Wave, sin backend Z-Wave en KrakenOS |
| **zigbee2mqtt** | Alternativa a `IOT_KIND=zigbee`: por aquí entra ya clasificado |

> **Por qué el prefijo se llama `homeassistant`.** Es el nombre que le puso el proyecto que inventó
> la convención y que el ecosistema adoptó. KrakenOS **no habla con Home Assistant** para esto: lee
> los anuncios que publica el propio aparato. Si tienes HA, los dos leéis lo mismo y no os estorbáis.
> El porqué, en [`adr-ingesta-mqtt.md`](adr-ingesta-mqtt.md).

## Qué necesitas

- Un **broker MQTT** en tu red (Mosquitto es lo habitual; vale el mismo que ya uses para
  zigbee2mqtt o Meross — son namespaces distintos y conviven).
- Tus aparatos configurados para **publicar su discovery** en ese broker (en ESPHome y Tasmota es
  una casilla; abajo está el detalle).
- El paquete `mqtt` en el servidor:

  ```bash
  cd /opt/krakenos && pnpm add mqtt
  ```

  Si instalaste con `install.sh --with-deps` o `--with-all`, ya está puesto **y sobrevive a las
  actualizaciones** (`data/extra-deps.json`).

## Configurarlo

**Desde la app (recomendado):** Conectar → *Enchufes e interruptores* → **MQTT Discovery** → pon la
dirección del broker → Probar conexión → Guardar. Se aplica en caliente, sin reiniciar.

**Por `.env`:**

```bash
IOT_KIND=mqtt
MQTT_DISCOVERY_URL=mqtt://192.168.1.10:1883
MQTT_DISCOVERY_PREFIX=homeassistant     # cámbialo solo si tus aparatos usan otro
# MQTT_DISCOVERY_USERNAME=krakenos
# MQTT_DISCOVERY_PASSWORD=
```

Puedes combinarlo con lo que ya tengas: `IOT_KIND=mqtt,hue` mete por protocolo los liberados y deja
los Hue por el suyo.

## Que tus aparatos se anuncien

- **ESPHome** — añade el bloque MQTT a su YAML. El discovery va activado por defecto:

  ```yaml
  mqtt:
    broker: 192.168.1.10
    username: krakenos
    password: TU_PASSWORD
  ```

- **Tasmota** — en la consola del aparato:

  ```
  Backlog MqttHost 192.168.1.10; MqttUser krakenos; MqttPassword TU_PASSWORD; SetOption19 1
  ```

  `SetOption19 1` es el que activa el anuncio.

- **OpenBeken** — pestaña *Config → MQTT*, y en *Home Assistant* pulsa el botón de **enviar el
  discovery**.

- **Z-Wave JS UI** — *Settings → Home Assistant*: activa **MQTT Discovery** apuntando al mismo
  broker.

- **zigbee2mqtt** — en su `configuration.yaml`:

  ```yaml
  homeassistant: true
  ```

Tras activarlo, los aparatos aparecen en `/iot` en segundos: el anuncio es **retenido**, así que el
broker se lo entrega a KrakenOS aunque el aparato lo publicara hace semanas.

## Qué trae de cada aparato

| En el aparato | En KrakenOS |
|---|---|
| `light` | Luz, con brillo si lo declara |
| `switch` | Enchufe |
| `cover` | Persiana, con posición |
| `climate` | Termostato (consigna y temperatura actual) |
| `lock` | Cerradura — **solo lectura**, ver abajo |
| `binary_sensor` (`door`/`window`/`opening`) | Sensor de apertura |
| `binary_sensor` (`smoke`/`gas`/`carbon_monoxide`) | Detector de humo/CO |
| `sensor` (temperatura, humedad, potencia, energía, batería, luz) | Lecturas del aparato |

Varias entidades del mismo aparato se agrupan en **un** dispositivo: un enchufe con medidor es un
enchufe **con** su lectura de potencia, no tres cacharros sueltos. Y esa potencia entra en el panel
de energía como la de cualquier otro.

## Lo que NO hace, dicho claro

- **No abre cerraduras.** Una `lock` se lee (echada / no echada) y no acepta órdenes: esa decisión
  tiene su propia historia pendiente (US-246). Un fallo ahí abre la puerta de la calle.
- **No interpreta plantillas complicadas.** El formato permite plantillas Jinja2 para sacar un valor
  de un mensaje; KrakenOS entiende las formas normales (`{{ value }}` y rutas como
  `{{ value_json.ENERGY.Power }}`) y **no ejecuta** las demás — sería ejecutar código que llega por
  la red. Un aparato con una plantilla rara se sigue viendo, pero esa lectura queda vacía.
- **No mapea el color** de una luz en esta primera versión (encendido y brillo sí).
- **No adivina un ventilador ni un robot aspirador**: si el aparato publica un componente que
  KrakenOS no sabe representar, lo ignora en vez de pintarlo como otra cosa.
- **No se anuncia a sí mismo por esta vía.** Lo que KrakenOS publica hacia Home Assistant es otra
  cosa y tiene su propio interruptor ([`interop.md`](interop.md)).

## Si no aparece nada

1. **Comprueba que el broker responde** desde el servidor:

   ```bash
   mosquitto_sub -h 192.168.1.10 -u krakenos -P TU_PASSWORD -t 'homeassistant/#' -v
   ```

   Si ahí no sale nada, el problema está entre el aparato y el broker, no en KrakenOS.

   > ⚠️ «Probar conexión» dice **«Conectado»** en cuanto el cliente MQTT arranca, aunque el broker
   > esté apagado: el aviso honesto es que **cero dispositivos** con el broker encendido y aparatos
   > publicando significa que algo falla antes. Este comando lo distingue en un segundo.

2. **Revisa el prefijo.** Si tus aparatos publican bajo otro (algún firmware permite cambiarlo),
   ponlo en `MQTT_DISCOVERY_PREFIX`.
3. **Fuerza el reanuncio.** En Tasmota, `SetOption19 0` seguido de `SetOption19 1`; en OpenBeken, el
   botón de enviar discovery; ESPHome lo republica al reiniciar el aparato.
4. **Aparece pero sin estado** (encendido/apagado vacío): suele ser una plantilla fuera del
   subconjunto soportado, o que el aparato publica su estado **sin retener** y aún no ha vuelto a
   emitir. Reinícialo y mira si llega.

> **Verificación con hardware real:** pendiente (US-86). Esta integración está probada contra el
> formato documentado y contra la salida real del publicador propio, no contra un ESPHome ni un
> Tasmota físicos.
