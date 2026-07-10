# ADR — Control por voz: ¿puente Matter o skill de nube? (US-173)

- **Estado:** Aceptado (2026-07-10)
- **Contexto de la decisión:** tras entregar el **puente Matter** (US-171) y el
  **comisionado Matter** (US-172), decidir con datos si KrakenOS necesita además una
  *smart-home skill* de Alexa o una *Google Home Action* de nube.
- **Decisión en una línea:** **No** se construye skill/Action de nube. El puente
  Matter cubre los casos de voz relevantes **sin romper el principio local-first**.
  Se revisará solo si aparece una necesidad concreta no cubierta (ver «Reevaluar»).

## El problema

La pregunta más frecuente de cualquier usuario de smart home es «¿funciona con
Alexa/Google?». Hay dos vías para responder que sí:

1. **Puente Matter (local).** KrakenOS se expone como un hub Matter en la LAN; Alexa,
   Google Home y Apple Home ya hablan Matter **localmente** y descubren sus
   dispositivos sin nube. Es lo entregado en US-171/172.
2. **Skill / Action de nube.** Publicar una *smart-home skill* (Alexa) o una *Home
   Action* (Google) que el asistente invoca **por internet**.

## Por qué la skill de nube choca con los principios del proyecto

Una smart-home skill de Alexa (o una Home Action de Google) exige, por diseño de esas
plataformas:

- **Un endpoint HTTPS público** (típicamente un AWS Lambda / Google Cloud Function)
  que reciba las directivas del asistente. KrakenOS corre en hardware del usuario y su
  premisa es **no exponer ningún puerto a internet** (el acceso remoto va por
  WireGuard). Un endpoint público rompe esa garantía o obliga a un relay en la nube.
- **Account linking (OAuth2)** entre la cuenta Amazon/Google del usuario y KrakenOS:
  infraestructura de identidad en la nube, consentimientos, tokens que hay que rotar y
  custodiar. Contradice «100% local, sin dependencias de nube de terceros».
- **Un servicio siempre disponible** públicamente: coste operativo, superficie de
  ataque y un punto único de fallo/tenencia (justo lo que el modelo local evita).

En resumen: la skill de nube **rompe el diferenciador** (local-first, sin puertos
expuestos, sin nube) a cambio de una función que el puente Matter ya da.

## Qué cubre el puente Matter (y qué no)

**Cubierto por Matter local (US-171/172), suficiente para el 95% de los casos:**

- Control por voz de luces y enchufes: «apaga la luz del salón», «pon la lámpara al
  20%», «pon la tira RGB en azul» → On/Off, Dimmable, Color.
- Descubrimiento y alta desde la propia app del asistente escaneando el QR del puente.
- Inclusión en las **rutinas/escenas del asistente** (Alexa Routines, Google/Apple
  automations): como los dispositivos son Matter estándar, entran en las rutinas nativas
  de cada plataforma sin nada extra por nuestra parte.

**Fuera del alcance de Matter (lo que una skill *sí* podría añadir):**

- **Intenciones de voz «a medida»** más allá de los tipos de dispositivo Matter (p. ej.
  «¿cuánto he consumido esta semana?» leyendo el panel de energía US-182, o «¿quién está
  en casa?» US-169). Matter no modela esas consultas; requerirían *custom intents*.
- **Anuncios/notificaciones proactivas** por voz («se ha detectado movimiento en la
  entrada»). Matter es control de dispositivos, no un canal de anuncios.
- **Escenas propias de KrakenOS (US-166) por nombre exacto** invocadas por voz. Mitigación
  local: exponer una escena como un enchufe/interruptor Matter virtual «pseudo-dispositivo»
  y meterla en una rutina del asistente — sin nube.

## Decisión y alcance

- **No implementar** skill de Alexa ni Home Action de Google por ahora. El puente Matter
  (US-171) + comisionado (US-172) es la vía oficial de «funciona con Alexa/Google/Apple».
- Las consultas de datos por voz (energía, presencia) y los anuncios proactivos quedan
  **explícitamente fuera** de la promesa de voz; si el mercado los exige, se abren como
  historias nuevas con su propio ADR de coste/beneficio.
- Para escenas por voz, se prefiere el **truco local** (escena → pseudo-dispositivo
  Matter → rutina del asistente) antes que una skill.

## Consecuencias

- **A favor:** se mantiene intacto el diferenciador local-first (sin puertos expuestos,
  sin nube, sin cuentas de terceros); cero coste e infra de nube; menor superficie de
  ataque; nada que mantener contra las cambiantes políticas de skills.
- **En contra:** las intenciones de voz avanzadas y los anuncios no están disponibles;
  el usuario que los quiera deberá recurrir a las rutinas nativas del asistente o esperar
  una historia futura.

## Reevaluar si…

- Un número relevante de usuarios pide explícitamente consultas por voz (energía/presencia)
  o anuncios proactivos, **y**
- Aparece una vía que **no** obligue a exponer puertos ni a un relay de nube propietario
  (p. ej. una futura extensión local del estándar, o un puente self-hosted que el usuario
  controle end-to-end).

En ese caso, este ADR se sustituye por uno nuevo con el diseño concreto y su análisis de
coste/beneficio.

> Verificación con asistentes reales del puente Matter: checklist de hardware (US-86).
