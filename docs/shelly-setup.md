# Activar la integración Shelly

La integración `shelly` (US-69) controla relés, enchufes y dimmers Shelly **localmente** (sin
nube), cubriendo las dos familias de firmware:

| Generación | Modelos | Protocolo local |
|---|---|---|
| **Gen1** | Shelly 1, 1PM, 2.5, Plug S, Dimmer 2, RGBW2 | REST HTTP (`GET /relay/0?turn=on`, `GET /status`) |
| **Gen2 / Gen3** | Plus 1, Plus 1PM, Plus Plug S, Pro 4PM, Mini | JSON-RPC (`POST /rpc`, `Switch.Set`, `Switch.GetStatus`) |

No hay dependencia npm nueva: usa `fetch` (global de Node 20). **No hay discovery fiable** sin
mDNS, así que los dispositivos se **configuran a mano**.

---

## 1. Desactivar la nube (recomendado)

Para control 100% local, en la app Shelly o la web del dispositivo:

- **Settings → Cloud → Disable** (o en Gen2: **Settings → Outbound websocket → off**).
- Asigna **IP fija** (DHCP reservation) a cada Shelly en tu router.

## 2. Configurar los dispositivos

`SHELLY_DEVICES` es un JSON con un objeto por dispositivo físico. **Cada canal es un device
independiente** (un Shelly 2.5 con 2 relés → 2 `IotDevice`, ids `shelly:<ip>:0` y `shelly:<ip>:1`).

| Campo | Valores | Notas |
|---|---|---|
| `ip` | string | IP fija del dispositivo |
| `name` | string | nombre base (se sufija `(1)`, `(2)`… si hay varios canales) |
| `gen` | `1` o `2` | generación del firmware |
| `channels` | número | nº de canales/relés (por defecto 1) |
| `type` | `"relay"` o `"light"` | `light` habilita el **brillo** (dimmers/RGBW) |

```bash
SHELLY_DEVICES=[
  {"ip":"192.168.1.80","name":"Caldera","gen":1,"channels":1,"type":"relay"},
  {"ip":"192.168.1.81","name":"Lámpara","gen":2,"channels":1,"type":"light"}
]
```

> El JSON va en **una sola línea** en el `.env`.

## 3. Autenticación (Gen1 con contraseña)

Si tus Shelly Gen1 tienen restricción de acceso (usuario/contraseña):

```bash
SHELLY_AUTH=true
SHELLY_USER=admin
SHELLY_PASSWORD=********
```

Los Gen2 usan auth de digest; para uso local en LAN normalmente se deja sin contraseña.

## 4. Configurar el `.env` del agente

```bash
IOT_KIND=shelly
SHELLY_DEVICES=[{"ip":"192.168.1.80","name":"Caldera","gen":1,"channels":1,"type":"relay"}]
SHELLY_AUTH=false
```

Se combina con otras integraciones: `IOT_KIND=hue,govee,shelly`. Reinicia el agente.

## 5. Campo de potencia

Los modelos con medición (1PM, 2.5, Plug S, Pro 4PM…) reportan vatios. El agente lo expone en
`IotDevice.reading` (`{metric:'potencia', value, unit:'W'}`), visible en `/iot`. Los modelos sin
medición dejan `reading: null`.

## 6. Verificación con hardware real

1. **Listar**: cada canal aparece en `/iot` con su nombre.
2. **Encender relé**: el relé conmuta al instante.
3. **Leer vatios**: en modelos con medición, la potencia se actualiza.
4. **Brillo** (`type:light`): el dimmer/RGBW responde al control de brillo.

## Limitaciones conocidas

- **Sin discovery automático**: hay que listar las IPs en `SHELLY_DEVICES`.
- El **color RGB** completo de los RGBW2 no se expone todavía (solo on/off + brillo).
- Gen2 con auth digest requiere configurar usuario/contraseña en el dispositivo y el `.env`.
