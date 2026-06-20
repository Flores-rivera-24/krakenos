# Activar Govee (API LAN por UDP, local)

El `GoveeIotManager` ya existe (US-29): controla las luces Govee **localmente** por la **API
LAN** (UDP multicast), sin pasar por la nube. Solo hay que habilitar "LAN Control" en cada
dispositivo y configurar el `.env`.

---

## 1. Habilitar "LAN Control" en la app Govee

El control local viene **desactivado** de fábrica. Para cada foco/tira compatible:

1. Abre la **app Govee Home** en el móvil.
2. Entra al dispositivo → icono de **ajustes** (arriba a la derecha).
3. Activa **"LAN Control"**.

> No todos los modelos Govee soportan LAN Control. Si la opción no aparece, ese modelo no es
> controlable localmente (quedaría solo por nube, fuera del principio local-first de KrakenOS).

## 2. Requisito de red

- El servidor de KrakenOS y los dispositivos Govee deben estar en la **misma subred/VLAN**.
- El discovery es por **multicast UDP** (`239.255.255.250:4001`). Si tienes los IoT en una VLAN
  separada (recomendado por seguridad), el multicast **no cruza** la VLAN salvo que configures
  un *mDNS/IGMP proxy* o pongas el servidor con una pata en esa VLAN.

## 3. Configurar el `.env`

```env
# IoT — Govee (API LAN por UDP, sin internet)
IOT_KIND=govee
GOVEE_LISTEN_PORT=4002   # puerto UDP donde el agente escucha las respuestas (default del protocolo Govee)
```

No hay claves ni tokens: el protocolo LAN de Govee no autentica (otra razón para tener los IoT
en su propia VLAN).

## 4. Probar

```bash
pnpm dev
```

- Ve a **`/iot`**: los dispositivos Govee deben aparecer conforme responden al discovery
  (llegan de forma asíncrona; puede tardar unos segundos).
- Prueba **on/off**, **brillo** y **color**.

Si no aparecen: confirma que "LAN Control" está activo, que el servidor está en la misma subred
y que el firewall del host permite UDP en `GOVEE_LISTEN_PORT` (4002) y el puerto de control
(4003). El discovery se relanza en cada `listDevices`, así que recargar `/iot` fuerza un nuevo
barrido.
