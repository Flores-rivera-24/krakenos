# Varios backends IoT a la vez (CompositeIotManager)

KrakenOS puede gestionar **varios ecosistemas IoT simultáneamente** (US-30). La factory acepta
`IOT_KIND` como **lista separada por comas**: con más de un valor, envuelve los managers en un
`CompositeIotManager` que enruta cada operación al backend correcto.

Funciona con cualquier combinación de los backends soportados: `hue`, `govee`, `zigbee`,
`matter`, `tuya`, `mock`.

---

## Ejemplo: Hue + Govee

```env
# IoT — múltiples backends a la vez (CompositeIotManager)
IOT_KIND=hue,govee

# Variables de cada backend (ver docs/hue-setup.md y docs/govee-setup.md):
HUE_BRIDGE_URL=https://192.168.1.50
HUE_APP_KEY=tu-application-key
GOVEE_LISTEN_PORT=4002

# Recuerda el workaround TLS del bridge Hue (solo LAN):
NODE_TLS_REJECT_UNAUTHORIZED=0
```

## Ejemplo: Hue + Govee + Tuya

```env
IOT_KIND=hue,govee,tuya
HUE_BRIDGE_URL=https://192.168.1.50
HUE_APP_KEY=tu-application-key
GOVEE_LISTEN_PORT=4002
TUYA_CONFIG_PATH=./tuya-devices.json
NODE_TLS_REJECT_UNAUTHORIZED=0
```

## Cómo se ven los dispositivos

Para evitar colisiones de id entre ecosistemas, el composite **prefija** cada id con el nombre
del backend:

- `hue:<id-del-light>`
- `govee:<mac>`
- `tuya:<deviceId>`

El enrutado se hace por el **primer `:`** del id, así que respeta ids que ya contienen `:`
(p. ej. las MAC de Govee). Todos los dispositivos se listan y controlan desde la misma página
**`/iot`**, sin que el usuario tenga que saber de qué backend viene cada uno.

> Con un único backend (`IOT_KIND=hue`), la factory devuelve el manager directo **sin prefijo**.
> El prefijo solo aparece cuando hay dos o más.

## Notas

- Cada backend mantiene sus propios requisitos (botón del bridge Hue, "LAN Control" en Govee,
  `localKey` por dispositivo en Tuya). Revisa la guía de cada uno.
- `startIotManager` (en `server.ts`) arranca en segundo plano los backends que mantienen una
  conexión viva (zigbee/govee); el composite propaga `start()` a todos.
