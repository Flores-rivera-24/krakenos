# Activar Matter (controlador, vía python-matter-server)

`IOT_KIND=matter` hace de KrakenOS un **controlador Matter**: lee y manda órdenes a los aparatos
Matter de tu casa a través de **python-matter-server**, por su API WebSocket. Es local (LAN/Thread),
sin la nube del fabricante.

> **No confundir con el [puente Matter](matter-bridge-setup.md).** El puente hace lo contrario:
> *expone* los aparatos de KrakenOS a Alexa/Google/Apple. Esta guía es para *controlar* aparatos
> Matter desde KrakenOS. Pueden convivir.

Qué hace (`apps/agent/src/iot/matter.iot.ts`):

- Lee los nodos con `get_nodes` y los clasifica por sus clusters: **cerradura**, **persiana**,
  **climatización**, **detector de humo**, **contacto**, **luz** (LevelControl), **enchufe**
  (OnOff) y, el resto, **sensor**.
- Manda órdenes con `device_command` (OnOff, LevelControl, WindowCovering) y escribe el setpoint
  del termostato.
- **Comisiona** aparatos nuevos con `commission_with_code`, aceptando el QR (`MT:…`) o el código
  manual de 11 dígitos, desde la propia app.
- Las cerraduras se **leen y se cierran**; abrir no se construye (ver
  [ADR de cerraduras](adr-cerraduras.md)).

---

## 1. Levantar python-matter-server

La forma más simple es su imagen oficial, en la **red del host** (Matter usa mDNS e IPv6):

```bash
docker run -d --name matter-server --restart unless-stopped \
  --network host \
  -v /opt/matter-server:/data \
  ghcr.io/home-assistant-libs/python-matter-server:stable
```

Escucha en `ws://<host>:5580/ws`. Requisitos de red del host: **IPv6 activo** en la interfaz de la
LAN y mDNS sin filtrar.

**Aparatos Thread** (la mayoría de sensores Matter): necesitas además un **border router Thread**
en la red (HomePod mini, Apple TV, Nest Hub, un OTBR propio…). Sin él, el comisionado falla con
el error «no hay border router Thread» — la app lo traduce a un mensaje claro.

## 2. Configurar KrakenOS

Requiere la dep opcional **`ws`** (`install.sh --with-deps`, o `cd apps/agent && pnpm add ws`).

**Desde la app:** Conectar → Matter. **Por `.env`:**

```env
IOT_KIND=matter                         # o combinado: IOT_KIND=matter,hue
MATTER_SERVER_URL=ws://localhost:5580/ws
```

## 3. Comisionar un aparato

En `/connect` → **Añadir aparato Matter**, pega el código del QR o el de 11 dígitos. Si el aparato
ya está en otro ecosistema (Apple/Google/Alexa), genera desde esa app un **código de
emparejamiento adicional** (*multi-admin*) y usa ese.

Errores que distingue la UI: código inválido, sin border router Thread, aparato no encontrado
(fuera de alcance o no en modo emparejamiento) y fallo genérico del controlador.

## Problemas típicos

- **No conecta**: `MATTER_SERVER_URL` debe incluir la ruta `/ws`.
- **El aparato se comisiona pero no aparece**: refresca `/iot`; los nodos se leen bajo demanda.
- **Se cae a ratos**: casi siempre es IPv6/mDNS del host (VLANs o filtrado multicast en el AP).
