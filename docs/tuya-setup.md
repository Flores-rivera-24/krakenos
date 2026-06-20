# Activar Tuya (focos genéricos de Amazon: EASYTAO y similares) — US-32

Muchos focos "inteligentes" baratos de Amazon (EASYTAO, etc.) son dispositivos **Tuya** de
marca blanca. KrakenOS los controla **localmente** (LAN, sin nube) con el protocolo Tuya sobre
**TCP 6668 + AES**. Para ello necesita, por cada foco, su **`deviceId`** y su **`localKey`**
(clave AES de 16 bytes única por dispositivo).

> Esta integración es **solo control local**. La nube de Tuya queda fuera de alcance (sería una
> historia aparte). Local-first, como el resto de KrakenOS.

---

## 1. Vincular los focos en la app Smart Life

1. Instala **Smart Life** (o **Tuya Smart**) en el móvil y crea una cuenta.
2. Empareja cada foco siguiendo la app (deben quedar en tu WiFi local).

## 2. Obtener `deviceId` y `localKey` desde el portal Tuya Developer

La `localKey` no está en la app: hay que sacarla del portal de desarrollador (gratis).

1. Crea una cuenta en **<https://iot.tuya.com>** (Tuya Developer Platform).
2. **Cloud → Development → Create Cloud Project** (elige tu región de data center, p. ej. EU).
3. En el proyecto → **Devices → Link App Account** → vincula tu cuenta de Smart Life
   (escaneando el QR desde la app: *Yo → ⚙ → Cuenta y seguridad*... según versión).
4. Tras vincular, en **Devices → All Devices** verás tus focos con su **Device ID**.
5. Para cada foco, abre su detalle / la pestaña relacionada y copia la **Local Key**.
   - Puede requerir suscribir el servicio gratuito **"IoT Core" / "Device Status Notification"**
     en *Service API* del proyecto.

### Alternativa más cómoda: `tuya-cli`

La herramienta oficial automatiza la extracción de claves a partir de las credenciales del
portal:

```bash
npx @tuyapi/cli wizard
```

Te pide el **Access ID/Secret** del proyecto Cloud y la región, y lista cada dispositivo con su
`id`, `key` (= localKey) y, si está en línea, su IP. Sigue las instrucciones en pantalla.

## 3. Averiguar la IP local de cada foco

Mírala en tu router, en **`/inventory`** de KrakenOS (busca el fabricante/hostname del foco) o
en la salida de `tuya-cli`. Conviene fijar una **IP estática (DHCP reservation)** para cada foco
en el router, así no cambia.

## 4. Instalar la dependencia en el servidor

El transporte real carga `tuyapi` con **import perezoso** (no está en `package.json` para no
romper el lockfile de CI). Instálalo en el servidor:

```bash
cd apps/agent
pnpm add tuyapi
```

## 5. Activar la integración en el `.env`

```env
# IoT — focos Tuya/Amazon (EASYTAO y similares), control local
IOT_KIND=tuya
TUYA_CONFIG_PATH=./data/tuya-devices.json   # fichero de config de dispositivos (se crea solo)
```

Para usarlo **junto con Hue** (o Govee), pon `IOT_KIND` como lista (ver
[composite-iot-setup.md](composite-iot-setup.md)):

```env
IOT_KIND=hue,tuya
HUE_BRIDGE_URL=https://192.168.1.50
HUE_APP_KEY=tu-application-key
TUYA_CONFIG_PATH=./data/tuya-devices.json
```

## 6. Registrar cada foco en KrakenOS

Los dispositivos Tuya se dan de alta por API (solo **admin**) — la `localKey` no se guarda en
`.env` porque es por dispositivo. Endpoints bajo **`/api/iot/tuya`**:

```bash
# Crear (registra el dispositivo en el store de config)
curl -X POST https://TU-SERVIDOR/api/iot/tuya/devices \
  -H 'Authorization: Bearer <access-token-admin>' \
  -H 'Content-Type: application/json' \
  -d '{
    "deviceId": "bf1234567890abcdef",
    "localKey": "0123456789abcdef",
    "ip": "192.168.1.80",
    "name": "Foco salón",
    "version": "3.3"
  }'
```

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/iot/tuya/devices` | Lista los dispositivos registrados (**sin** `localKey`) |
| POST | `/api/iot/tuya/devices` | Registra un dispositivo (`deviceId`, `localKey`, `ip`, `name`, `version?`) |
| PATCH | `/api/iot/tuya/devices/:deviceId` | Actualiza `ip`, `localKey` o `name` (404 si no existe) |
| DELETE | `/api/iot/tuya/devices/:deviceId` | Elimina el dispositivo (204 / 404) |

> La `localKey` se acepta al crear/actualizar pero **nunca** se devuelve en ningún GET.

Una vez registrados, los focos aparecen en **`/iot`** como cualquier otra luz (on/off + brillo).

## 7. Probar

```bash
pnpm dev
```

- Ve a **`/iot`**: los focos Tuya registrados deben aparecer y responder a on/off y brillo.
- Si un foco no responde, se muestra con `reachable: false` (último estado conocido).

## Notas importantes

- **La `localKey` cambia** si desvinculas y vuelves a vincular el foco en la app Smart Life. Si
  un foco deja de responder de golpe, re-extrae la clave (paso 2) y actualízala con `PATCH`.
- Los focos genéricos usan distintos números de DPS según el firmware: KrakenOS soporta tanto el
  esquema **nuevo** (DPS 20 = on, 22 = brillo) como el **viejo** (DPS 1 = on, 2 = brillo).
- El **color** aún no se controla (solo on/off + brillo). El contrato IoT ya lo soporta para
  Hue/Govee; mapear el modo de color de Tuya es un refinamiento futuro.
- Recomendado: mantén los IoT en su **propia VLAN** y reserva IP por DHCP para cada foco.
