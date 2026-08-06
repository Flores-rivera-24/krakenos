# ADR — Certificación del puente Matter: el muro real

- **Estado:** Aceptado (2026-07-13)
- **Contexto de la decisión:** el puente Matter y el comisionado exponen los
  dispositivos de KrakenOS a Alexa/Google/Apple **en LAN, sin nube**. Funciona, pero hay una
  fricción que el usuario descubre al escanear el QR: el ecosistema le avisa de que el dispositivo
  **«no está certificado»**. Esta decisión documenta ese muro y por qué **no** se cruza ahora.
- **Decisión en una línea:** KrakenOS **no** obtiene la certificación CSA por ahora. El puente se
  entrega **honesto**: la app avisa de las advertencias del ecosistema antes de que aparezcan, y el
  usuario decide. Se reevaluará solo con señales concretas de mercado (ver «Reevaluar»).

## El problema

Matter es un estándar de la **Connectivity Standards Alliance (CSA)**. Cada dispositivo o hub que
se comisiona lleva un **VID/PID** (Vendor ID / Product ID). Hay dos clases:

1. **VID/PID de test** (los `0xFFF1`…`0xFFF4` que la CSA reserva para desarrollo). Es lo que usa
   cualquier proyecto self-hosted (incluido nuestro `real-stack.ts` sobre `@matter/main`) sin pagar
   la certificación.
2. **VID/PID certificado**, asignado tras pasar el proceso de certificación de la CSA.

Al comisionar un hub con **VID/PID de test**, los ecosistemas reaccionan así:

- **Alexa / Google Home / Apple Home** muestran una advertencia explícita de tipo «este accesorio
  **no está certificado**» / «fabricante desconocido» antes de completar el emparejamiento.
- Algunos ecosistemas **restringen** o degradan funciones para dispositivos no certificados (y las
  políticas cambian con el tiempo, sin previo aviso).
- El emparejamiento en sí **suele completarse** —el usuario puede aceptar la advertencia— pero la
  experiencia no es la «marca verde» de un producto certificado.

## El coste de cruzar el muro

La certificación CSA **no es gratis ni trivial**:

- **Membresía CSA** (cuota anual, con tramos de varios miles de dólares según nivel).
- **Coste por producto certificado** + laboratorio de pruebas de interoperabilidad.
- **VID propio** asignado por la CSA y **gestión del ciclo de vida** de la certificación (recerts al
  cambiar funcionalidad).
- Proceso pensado para **fabricantes de producto**, no para software self-hosted que un usuario
  ejecuta en su propio hardware: el modelo de certificación asume un dispositivo físico con un
  firmware fijo, no un puente que expone dispositivos de terceros que cambian.

Para un proyecto personal/open-source en fase de **validación de mercado** (ver
[`adr-positioning.md`](adr-positioning.md)), pagar la certificación **antes** de tener usuarios
reales que la pidan sería invertir miles de dólares contra una demanda no demostrada.

## Decisión y alcance

1. **No se certifica** el puente Matter por ahora. Se sigue usando VID/PID de test.
2. El puente se entrega con **honestidad de expectativa**, no ocultando la fricción:
   - Un **callout de aviso en `MatterBridgeCard`** advierte, antes de escanear el QR, de que el
     asistente puede marcar el dispositivo como «no certificado» y que es esperable.
   - La documentación de setup (`matter-bridge-setup.md`) y el README lo recogen.
3. El puente **es opt-in y está OFF por defecto**: quien no lo activa nunca ve la fricción.

## Consecuencias

- **A favor:** cero coste de certificación; el usuario no se lleva una sorpresa (sabe de la
  advertencia antes de encontrarla); coherente con la fase de validación de mercado.
- **En contra:** la experiencia de emparejamiento no es «premium»; algún usuario puede desconfiar de
  la advertencia del ecosistema o toparse con una restricción de plataforma; el mensaje comercial
  «funciona con Alexa/Google/Apple» lleva un asterisco.

## Reevaluar si…

- Un número relevante de usuarios reales reporta que la advertencia de «no certificado» es
  un **bloqueante de adopción** (no una molestia), **y**
- Existe un **modelo de sostenibilidad** (caja de hardware propia o ingresos) que absorba el
  coste de la membresía CSA y el ciclo de recertificación, **o**
- La CSA introduce una **vía de certificación para software/self-hosted** con coste proporcionado.

En ese caso, este ADR se sustituye por uno nuevo con el plan de certificación y su presupuesto.

> Verificación de las advertencias reales con asistentes físicos: checklist de hardware.
