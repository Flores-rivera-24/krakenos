# Activar Matter (controlador, vía python-matter-server)

`IOT_KIND=matter` hace de KrakenOS un **controlador Matter**: lee y manda órdenes a los aparatos
Matter de tu casa a través de **python-matter-server**, por su API WebSocket. Es local (LAN/Thread),
sin la nube del fabricante.

> **No confundir con el [puente Matter](matter-bridge-setup.md).** El puente hace lo contrario:
> _expone_ los aparatos de KrakenOS a Alexa/Google/Apple. Esta guía es para _controlar_ aparatos
> Matter desde KrakenOS. Pueden convivir.

Qué hace (`apps/agent/src/iot/matter.iot.ts`):

- Lee los nodos con `get_nodes` y los clasifica por sus clusters: **cerradura**, **persiana**,
  **climatización**, **detector de humo**, **contacto**, **luz** (LevelControl), **enchufe**
  (OnOff) y, el resto, **sensor**.
- Manda órdenes con `device_command` (OnOff, LevelControl, WindowCovering) y escribe el setpoint
  del termostato.
- **Comisiona** aparatos nuevos con `commission_with_code`, aceptando el QR (`MT:…`) o el código
  manual de 11 dígitos, desde la propia app.
- Las cerraduras **solo se leen**: KrakenOS no les manda ninguna orden, y abrir no se construye
  (ver [ADR de cerraduras](adr-cerraduras.md)). Los sensores y detectores tampoco aceptan órdenes.

> **Sin verificar con aparatos reales.** El backend está probado contra un servidor simulado; no
> consta una prueba con un python-matter-server y aparatos Matter físicos.

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
en la red (HomePod mini, Apple TV, Nest Hub, un OTBR propio…). Sin él, el comisionado falla y la app
lo explica: «Es un dispositivo Thread y no hay un border router en tu red».

## 2. Configurar KrakenOS

El cliente WebSocket (`ws`) ya viene con el agente: no hay que instalar nada más en KrakenOS.

**Desde la app:** Conectar → Luces inteligentes → Matter. **Por `.env`:**

```env
IOT_KIND=matter                         # o combinado: IOT_KIND=matter,hue
MATTER_SERVER_URL=ws://localhost:5580/ws
```

## 3. Comisionar un aparato

En **Conectar** → **Añadir un dispositivo Matter** (solo administradores), pega el código del QR o el de 11 dígitos. Si el aparato
ya está en otro ecosistema (Apple/Google/Alexa), genera desde esa app un **código de
emparejamiento adicional** (_multi-admin_) y usa ese.

Errores que distingue la UI: código inválido, sin border router Thread, aparato no encontrado
(fuera de alcance o no en modo emparejamiento) y fallo genérico del controlador.

## Problemas típicos

- **No conecta**: `MATTER_SERVER_URL` debe incluir la ruta `/ws`.
- **El aparato se comisiona pero no aparece**: refresca `/iot`; los nodos se leen bajo demanda.
- **Se cae a ratos**: casi siempre es IPv6/mDNS del host (VLANs o filtrado multicast en el AP).
