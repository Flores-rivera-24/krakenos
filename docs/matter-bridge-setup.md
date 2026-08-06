# Puente Matter — exponer KrakenOS a Alexa / Google / Apple

KrakenOS puede actuar como un **puente Matter** (bridge): los dispositivos IoT que
elijas aparecen en Alexa, Google Home o Apple Home como si fueran un hub más, y se
controlan **por voz en tu red local, sin cuentas ni nube extra**.

> **Local-first:** Alexa/Google/Apple ya hablan Matter sobre la LAN. El puente no
> abre ningún puerto a internet: se comisiona con un QR en la misma red.

## Cómo funciona

- En **Ajustes → Integraciones → Puente Matter** activas el puente (opt-in) y eliges
  qué dispositivos exponer. Cada aparato se publica como el tipo de endpoint Matter
  que corresponde a sus capacidades:
  - enchufe o luz simple → **On/Off**
  - luz regulable → **Dimmable**
  - luz de color → **Color**
- Se muestra un **QR** (y un código manual). En tu app de asistente añades un
  «dispositivo/hub Matter» y escaneas el QR.
- Los comandos de voz («apaga la lámpara del salón») llegan al puente y KrakenOS los
  aplica al dispositivo real. Cada comando entrante queda **auditado** (`matter.command`,
  procedencia `origen:matter`).

## Puesta en marcha en el servidor (producción)

En desarrollo el puente usa un **stack mock** (genera un QR de ejemplo, no comisiona
de verdad). En un despliegue real:

1. Instala el stack Matter (dependencia opcional, patrón de hardware):
   ```bash
   pnpm add @matter/main
   ```
2. Arranca el agente con `MATTER_BRIDGE_KIND=matter`.
3. Activa el puente desde la UI y elige los dispositivos.

## Seguridad

- **Opt-in explícito**: nace desactivado; solo se exponen los dispositivos elegidos.
- **Superficie acotada**: un comando entrante para un dispositivo no expuesto se ignora.
- Activar/desactivar y elegir dispositivos es **solo admin** y auditado.

## Verificación con asistentes reales — pendiente

La lógica de mapeo IoT↔Matter está cubierta por tests unitarios. La verificación
**end-to-end con Alexa/Google/Apple reales** (comisionado, control por voz, altas/bajas
en caliente) se hace en el despliegue, como el resto de integraciones de hardware
(pendiente de verificación con hardware real).
