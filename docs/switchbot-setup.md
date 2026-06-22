# Activar la integración SwitchBot

La integración `switchbot` (US-72) controla dispositivos SwitchBot (Bot, Plug Mini, Color Bulb,
Strip Light, Ceiling Light) a través de la **API REST local** del **Hub Mini** o **Hub 2**, sin
la app ni la nube de SwitchBot. No hay dependencia npm nueva: usa `fetch` (global de Node 20).

> Requiere un **Hub Mini** o **Hub 2** (el Hub Mini "+" / Hub original no exponen la API local
> usada aquí). Los dispositivos BLE (Bot, Plug Mini…) se controlan **a través del hub**.

---

## 1. Habilitar la API local en la app SwitchBot

1. Abre la app SwitchBot → tu **Hub Mini/Hub 2** → ajustes del dispositivo.
2. Activa la **API en LAN / Local control** (según versión de firmware del hub).
3. Asegúrate de que el hub tiene **IP fija** (DHCP reservation) en tu router.
4. Obtén el **token** (en la app: **Perfil → Preferencias → Modo desarrollador → Token**). Se usa
   en la cabecera `Authorization`.

## 2. Configurar el `.env` del agente

```bash
IOT_KIND=switchbot
SWITCHBOT_HUB_HOST=192.168.1.90
SWITCHBOT_HUB_PORT=8123
SWITCHBOT_TOKEN=<token-de-la-app>
```

Se combina con otras integraciones: `IOT_KIND=hue,switchbot`. Reinicia el agente; los
dispositivos soportados aparecen en `/iot`.

## 3. Dispositivos soportados

| Tipo SwitchBot | Mapea a | Controles |
|---|---|---|
| Bot | enchufe | on/off (pulsa el botón) |
| Plug Mini (US/JP) | enchufe | on/off |
| Color Bulb | luz | on/off, brillo, color/temperatura |
| Strip Light | luz | on/off, brillo, color |
| Ceiling Light | luz | on/off, brillo, temperatura |

> Otros tipos (Meter, Curtain, Lock…) se **filtran** y no aparecen en `/iot` en esta versión.

## 4. Cómo funciona

- `listDevices` → `GET /v1.0/devices` (filtra los tipos soportados).
- `getDevice` → `GET /v1.0/devices/<id>/status` (power, brillo, color).
- `setState` → `POST /v1.0/devices/<id>/commands` con `{command, parameter, commandType}`
  (`turnOn`/`turnOff`/`setBrightness`/`setColor`/`setColorTemperature`).

## 5. Verificación con hardware real

1. **Listar**: los dispositivos soportados aparecen en `/iot`.
2. **Encender un Bot/Plug**: responde al instante.
3. **Brillo/color** (Color Bulb / Strip Light): cambian.

## Limitaciones conocidas

- Requiere **Hub Mini o Hub 2** con la API local habilitada y un **token** válido.
- El estado on/off real solo se lee en `getDevice` (la lista no lo trae): en `/iot` el detalle de
  cada dispositivo refleja el status.
- Sensores (Meter), persianas (Curtain) y cerraduras (Lock) no se exponen todavía.
