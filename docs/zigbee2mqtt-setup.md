# Activar Zigbee (vía zigbee2mqtt)

`IOT_KIND=zigbee` conecta KrakenOS a **zigbee2mqtt** por MQTT. zigbee2mqtt es la fuente de
verdad: empareja los aparatos con tu coordinador USB y publica su estado; KrakenOS se suscribe y
manda órdenes. Nada sale de tu red.

> **¿`zigbee` o `mqtt`?** Si ya tienes zigbee2mqtt con *Home Assistant integration* activada,
> también entra por **MQTT Discovery** (`IOT_KIND=mqtt`, ver
> [`mqtt-discovery-setup.md`](mqtt-discovery-setup.md)). `zigbee` lee el registro propio de
> zigbee2mqtt (`bridge/devices`) y no depende de que el discovery esté encendido. No actives los
> dos sobre el mismo broker o verás cada aparato dos veces.

Topics que usa (con el `base_topic` por defecto, `zigbee2mqtt`):

| Topic | Para qué |
|---|---|
| `zigbee2mqtt/bridge/devices` | registro de dispositivos (nombre, tipo inferido de sus *exposes*) |
| `zigbee2mqtt/<nombre>` | estado de cada dispositivo |
| `zigbee2mqtt/<nombre>/availability` | online / offline |
| `zigbee2mqtt/<nombre>/set` | órdenes (on/off, brillo, persiana, termostato) |

Tipos que reconoce: **luces** (si expone `light` o `brightness`), **enchufes** (`switch` o
`state`), persianas, climatización y, el resto, **sensores**.

---

## 1. Requisitos

- Un **coordinador Zigbee** USB (Sonoff ZBDongle-E/-P, SLZB-06, ConBee II…).
- Un **broker MQTT** local (Mosquitto).
- **zigbee2mqtt** corriendo y con tus aparatos emparejados.
- La dep opcional **`mqtt`** en el servidor (`install.sh --with-deps`, o
  `cd apps/agent && pnpm add mqtt`).

## 2. zigbee2mqtt

En su `configuration.yaml`, lo relevante:

```yaml
mqtt:
  base_topic: zigbee2mqtt
  server: mqtt://localhost:1883
  # user: krakenos
  # password: ...
availability:
  enabled: true      # sin esto, KrakenOS no sabe si un aparato está caído
```

Dale a cada aparato un **nombre amigable** (`friendly_name`): es el id que verás en KrakenOS.

## 3. Configurar KrakenOS

**Desde la app:** Conectar → luces/enchufes → Zigbee.

**Por `.env`:**

```env
IOT_KIND=zigbee                       # o combinado: IOT_KIND=zigbee,hue
ZIGBEE2MQTT_URL=mqtt://localhost:1883
ZIGBEE2MQTT_BASE_TOPIC=zigbee2mqtt
# ZIGBEE2MQTT_USERNAME=
# ZIGBEE2MQTT_PASSWORD=
```

## 4. Probar

En `/iot` aparecen los aparatos en cuanto llega `bridge/devices` (zigbee2mqtt lo publica
*retained*). Enciende y apaga una luz: KrakenOS actualiza la caché de forma optimista y
zigbee2mqtt lo confirma por su topic de estado.

## Problemas típicos

- **No aparece nada**: comprueba con `mosquitto_sub -t 'zigbee2mqtt/bridge/devices' -v` que el
  registro llega, y que `ZIGBEE2MQTT_BASE_TOPIC` coincide con `base_topic`.
- **Todo sale como «sensor»**: el aparato no expone `state`/`brightness`; es lo esperado para
  sensores de puerta, temperatura, etc.
- **Siempre «online»**: activa `availability` en zigbee2mqtt.
