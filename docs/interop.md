# Interop abierta: tokens de API + MQTT (US-174)

KrakenOS se integra con Home Assistant, Node-RED u otras herramientas **sin darles tu
contraseña** ni depender de la nube: un **token de API** con permisos acotados para
llamar a la API, y una **publicación MQTT** opcional del estado del hogar.

## Tokens de API

Crea tokens en **Ajustes → Cuenta → Tokens de API**. Cada token:

- Es **personal** (lo gestiona su dueño con su sesión) y se muestra **una sola vez** al
  crearlo (se guarda solo su hash — como los refresh tokens; guárdalo al momento).
- Tiene **permisos (scopes)** acotados a lo que tu rol permite y que **nunca lo superan**:
  - `home.view` — leer el estado del hogar (todas las lecturas `GET`).
  - `home.control` — controlar dispositivos (encender/apagar IoT, ejecutar escenas,
    acción de grupo). Solo lo pueden conceder `admin`/`member`.
- **Nunca administra.** Un token de API no puede tocar red, usuarios, sistema, backup ni
  gestionar tokens: esas operaciones exigen una **sesión con contraseña**. Un token que
  golpee una ruta de administración recibe `403 API_TOKEN_FORBIDDEN`.
- Es **revocable** al instante (borrar el token en la lista lo invalida de inmediato) y
  **auditado** (`apitoken.create` / `apitoken.revoke`). Si el usuario se deshabilita o su
  rol baja, el token pierde el acceso correspondiente automáticamente.

### Uso

Pasa el token en la cabecera `Authorization`, igual que un access token de sesión:

```bash
curl -H "Authorization: Bearer krt_xxxxxxxx" https://tu-krakenos/api/iot/devices
# controlar (requiere el permiso home.control):
curl -X PATCH -H "Authorization: Bearer krt_xxxxxxxx" -H "Content-Type: application/json" \
     -d '{"on":true}' https://tu-krakenos/api/iot/devices/<id>
```

## Publicación MQTT (Home Assistant / Node-RED)

En **Ajustes → Integraciones → Publicar a MQTT** (admin) puedes publicar el estado del
hogar a un **broker MQTT local**. Es **opt-in y off por defecto**.

- El broker (`mqtt://host:port`) pasa por la **política de egress**: no puede apuntar a
  metadata de nube ni link-local (solo LAN/loopback).
- La contraseña del broker se guarda **cifrada** (secretbox) y **nunca** se devuelve por
  la API ni aparece en ningún payload.
- Requiere el paquete `mqtt` en el servidor (`pnpm add mqtt`); es una dependencia
  opcional de runtime (no viaja en la imagen por defecto). La conexión real se verifica
  en el despliegue (checklist US-86).

### Topics publicados

Con prefijo configurable (por defecto `krakenos`) y cada `intervalSec` segundos:

| Topic | Payload |
|---|---|
| `<prefijo>/status` | `online` |
| `<prefijo>/iot/<id>` | JSON `{ name, on, brightness, powerW }` por dispositivo IoT |
| `<prefijo>/energy` | JSON `{ todayKwh, todayCost, currency }` |
| `<prefijo>/devices/online` | nº de dispositivos de red en línea (resumen, **sin MAC/IP**) |

Los payloads **no contienen secretos ni PII cruda** (ni credenciales, ni MAC/IP por
dispositivo). Pensado para automatizaciones de HA/Node-RED sobre el estado del hogar.
