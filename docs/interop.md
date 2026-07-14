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

## MQTT Discovery de Home Assistant (US-213)

Además de los topics de arriba, KrakenOS puede publicar la **convención de discovery** de
Home Assistant para que HA **descubra tus dispositivos solo**, sin mapear topics a mano.
Son **dos toggles separados** en **Ajustes → Integraciones → Publicar a MQTT**, ambos
**off por defecto**:

- **Descubrimiento de Home Assistant** — publica configs **retained** bajo
  `homeassistant/<componente>/krakenos/<objeto>/config`. HA crea solo las entidades:
  - un **switch/light** por dispositivo IoT (brillo y color según capacidades),
  - un **sensor** de potencia (W) por aparato que la mida,
  - sensores del hogar: **energía** (kWh), **modo del hogar**, **estado de la alarma** y
    **dispositivos en línea**.
  - Del modo del hogar viaja **solo el modo** (`home`/`away`/`night`), **nunca las
    personas** (regla de privacidad US-169).
  - Al **quitar** un dispositivo (o desactivar el discovery), su config retenida se
    **limpia** (se publica un payload vacío retenido).
- **Aceptar órdenes desde MQTT** — «publicar estados **≠** aceptar órdenes». Este permiso,
  **aparte** y también off por defecto, suscribe a `<prefijo>/iot/<id>/set` (+
  `…/brightness/set`, `…/rgb/set`) y aplica el comando con `setState`, con **timeout** de
  acción, marcado con `origin:'mqtt'` para el **anti-bucle** de automatizaciones (US-167) y
  **auditado** (`interop.mqtt.command`). Sin este toggle, las entidades de HA son de
  **solo lectura** (un `light` requiere control; sin él se expone como `switch` de lectura).

### Receta rápida

1. Ten un broker MQTT en la LAN (p. ej. el add-on *Mosquitto* de HA) y la integración
   **MQTT** de HA configurada contra él.
2. En KrakenOS: **Ajustes → Integraciones → Publicar a MQTT** → pon la URL del broker (y
   usuario/contraseña si aplica), activa **Publicar**, activa **Descubrimiento de Home
   Assistant** y, si quieres controlar desde HA, **Aceptar órdenes desde MQTT**. Guarda.
3. En HA, **Ajustes → Dispositivos y servicios → MQTT** → aparecerá el dispositivo
   **KrakenOS** con sus entidades. (Verificación con un HA real: checklist US-86.)

> El prefijo de discovery de HA es `homeassistant/` por convención; los estados viven bajo
> tu `<prefijo>` (por defecto `krakenos`). Ambos coexisten con los topics legados de US-174.
