# Interop abierta: tokens de API + MQTT

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
  en el despliegue (checklist de verificación con hardware).

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

## MQTT Discovery de Home Assistant

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
    personas** (regla de privacidad).
  - Al **quitar** un dispositivo (o desactivar el discovery), su config retenida se
    **limpia** (se publica un payload vacío retenido).
- **Aceptar órdenes desde MQTT** — «publicar estados **≠** aceptar órdenes». Este permiso,
  **aparte** y también off por defecto, suscribe a `<prefijo>/iot/<id>/set` (+
  `…/brightness/set`, `…/rgb/set`) y aplica el comando con `setState`, con **timeout** de
  acción, marcado con `origin:'mqtt'` para el **anti-bucle** de automatizaciones y
  **auditado** (`interop.mqtt.command`). Sin este toggle, las entidades de HA son de
  **solo lectura** (un `light` requiere control; sin él se expone como `switch` de lectura).

## Lo que solo KrakenOS sabe

Con el descubrimiento activo, además de luces y enchufes aparecen en HA las tres cosas
que **Home Assistant no tiene de serie** — que son la razón de instalar KrakenOS junto a él:

| Entidad en HA | Qué es | Notas |
|---|---|---|
| `binary_sensor` **«… · internet bloqueado»** | Uno **por dispositivo** de red. `ON` = ese aparato está sin internet ahora | El estado es el **derivado** de las tres fuentes (bloqueo manual · horario · pausa). Sus atributos traen la razón (`razones: ["schedule"]`) |
| `sensor` **«… · señal de los aparatos»** | Uno **por habitación**: la **peor** señal WiFi entre sus aparatos conectados, en dBm | Si la habitación no tiene ningún aparato WiFi en línea, la entidad se marca **no disponible** — no se inventa un valor |
| `button` **«… · pausar internet 30 min»** | Uno por dispositivo. Al pulsarlo, corta su internet 30 minutos | **Off por defecto**, con su propio permiso (abajo) |

### Por qué el sensor se llama «señal» y no «cobertura»

Porque el RSSI que se publica lo mide el **punto de acceso**, no el móvil: es la señal
con la que el router **oye** a tus aparatos. Es un dato medido y actual, pero no es lo
mismo que «la cobertura de esa habitación».

El mapa de calor de la página de Cobertura **no** se publica en HA a propósito: es un
**modelo predictivo** calculado sobre el plano, no una medida, y no cambia si un punto de
acceso se cae. Publicarlo como `signal_strength` habría sugerido en HA una medida viva que
no existe.

### Qué NO aparece en HA, y por qué

- **El uso de internet por persona (bienestar digital).** El dato **no existe** todavía
  fuera del modo de demostración: los drivers de router que KrakenOS soporta hoy no
  reportan el desglose de tráfico **por aparato**, así que ese sensor publicaría cero para
  todo el mundo, para siempre. Se publicará cuando el dato exista de verdad.
- **La lista de personas que hay en casa.** Por MQTT viaja **solo el modo del hogar**
  (`home`/`away`/`night`), nunca quién está. Es una regla de privacidad deliberada: un
  broker MQTT no distingue quién lee, y el nombre acabaría además en el registro de
  entidades de HA, que no se limpia al borrar la entidad.
- **La cobertura por habitación como medida.** Ver arriba.

### El permiso de pausar es aparte, y a propósito

Hay **dos** permisos de control entrante, ambos off por defecto, y no se fusionan:

- **Aceptar órdenes desde MQTT** — «HA puede encender/apagar mis aparatos IoT».
- **Permitir pausar internet desde MQTT** — «HA puede dejar sin internet a alguien de casa».

No son lo mismo. Un broker MQTT **no tiene sujeto**: quien tenga sus credenciales puede
publicar. La ruta HTTP equivalente (`POST /api/access/pause`) es solo para administradores y
rechaza los tokens de API, así que exponerla por MQTT sin un consentimiento propio sería
una escalada de privilegio. Cada pausa aplicada por esta vía queda **auditada** con su
origen (`interop.mqtt.pause`, `origen:mqtt`).

### Si el agente se cae, HA se entera

Todas las entidades cuelgan de un topic de disponibilidad (`<prefijo>/status`) respaldado
por un **LWT** (*last will and testament*): si KrakenOS muere de golpe, es el **broker**
quien publica `offline` en su nombre y HA marca las entidades como no disponibles. En un
apagado ordenado, el agente se despide él mismo antes de desconectar.

Sin esto —como ocurría antes— HA seguía mostrando la casa entera disponible, con su
último valor retenido, indefinidamente.

### Receta rápida

1. Ten un broker MQTT en la LAN (p. ej. el add-on *Mosquitto* de HA) y la integración
   **MQTT** de HA configurada contra él.
2. En KrakenOS: **Ajustes → Integraciones → Publicar a MQTT** → pon la URL del broker (y
   usuario/contraseña si aplica), activa **Publicar**, activa **Descubrimiento de Home
   Assistant** y, si quieres controlar desde HA, **Aceptar órdenes desde MQTT** y/o
   **Permitir pausar internet desde MQTT** (son permisos distintos).
3. En HA, **Ajustes → Dispositivos y servicios → MQTT** → aparecerá el dispositivo
   **KrakenOS** con sus entidades. (Verificación con un HA real: pendiente de hardware.)

> El prefijo de discovery de HA es `homeassistant/` por convención; los estados viven bajo
> tu `<prefijo>` (por defecto `krakenos`). Ambos coexisten con los topics legados del publicador original.
