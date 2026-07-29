# ADR — Posicionamiento: «el cerebro de red del hogar» (US-211)

> ⚠️ **Parcialmente sustituido el 2026-07-29 por [`adr-control-total.md`](adr-control-total.md).**
> Se conserva la tesis central (complemento de Home Assistant, delegación de cámaras a Frigate y de
> voz a Matter). Se **revierten** tres decisiones concretas de este documento: (1) IoT deja de ser
> vertical «suficiente» y pasa a **core** acotado por protocolo abierto (§ tabla de verticales),
> (2) la interop deja de ser solo saliente — se añade un consumidor MQTT Discovery **entrante**
> genérico (§ «KrakenOS + Home Assistant»), y (3) el instalador deja de ser puerta de entrada válida
> sin TLS (§ «Honestidad como parte del posicionamiento»). El enemigo declarado pasa a ser **la app
> del fabricante**, no Home Assistant. Lee el ADR nuevo antes de tomar decisiones sobre IoT.

- **Estado:** Aceptado (2026-07-13) · parcialmente sustituido (2026-07-29)
- **Contexto de la decisión:** tras cerrar la Fase 5 («Hogar para todos», US-165…196) KrakenOS
  tiene una superficie enorme —red, IoT, cámaras, energía, presencia, planos, Matter, i18n— pero
  **ninguna validación de mercado**. Un análisis adversarial de producto contra el mercado real
  (Home Assistant, UniFi/Firewalla, Frigate/Scrypted, Fing, Nabu Casa) dejó un diagnóstico incómodo
  pero claro: **ingeniería de percentil 95, validación de mercado de percentil 0.**
- **Decisión en una línea:** KrakenOS es **«el cerebro de red del hogar»** — un **complemento de
  Home Assistant, no un sustituto**. Se compite en la **cuña que nadie más tiene** (cobertura WiFi +
  planos + parental + presencia + bienestar + seguridad de red, todo local) y se **delega** a
  best-in-class gratuito donde competir sería inútil (Frigate para cámaras serias, Matter para voz).

## El problema

Hasta ahora KrakenOS se describía como «SmartThings sin nube con superpoderes de red» (Fase 5) e
intentaba, de facto, **ganar en amplitud a cinco gigantes gratuitos a la vez**:

- **Home Assistant** — ~2.800 integraciones, comunidad enorme, gratis. La amplitud de HA no se
  alcanza; intentarlo es una carrera perdida por definición.
- **Frigate / Scrypted** — detección de objetos por ML (persona/coche/animal), pre-roll continuo,
  NVR. El detector propio (diferencia de grises 32×24, US-186) es un juguete a su lado.
- **UniFi / Firewalla** — hardware+software de red pulido, con equipo y soporte comercial.
- **Fing** — descubrimiento e inventario de red con una base de datos de dispositivos gigante.
- **Nabu Casa** — el modelo de sostenibilidad (relay de nube de pago) que financia HA.

Competir en el terreno de cada uno de ellos, en paralelo y en solitario, es la receta para no ganar
en ninguno. **La pregunta correcta no es «¿cómo igualo a HA?» sino «¿qué hago yo que HA no hace?».**

## La cuña única (por qué existe un hueco)

Lo que KrakenOS reúne **en un solo producto local** y ningún competidor tiene junto:

- **Cobertura WiFi + planos inteligentes** — heatmap RF sobre el plano real de la casa, importado
  desde una foto/PDF/Word con detección asistida de paredes (US-151…159, US-194…196). Nadie del
  ecosistema smart-home hace esto; es territorio de herramientas WiFi profesionales de pago.
- **Control parental de red de verdad** — cortar internet por dispositivo en ventanas horarias o de
  un toque (US-108/111), no un temporizador de enchufe.
- **Presencia por WiFi sin geofence de nube** + **modos del hogar** (US-169).
- **Bienestar digital** — uso de internet por persona con privacidad por rol (US-184).
- **Seguridad de red** — inventario, bloqueo, DNS con listas por categoría, VLAN/QoS/firewall,
  VPN WireGuard propia, backup cifrado, multi-usuario auditado (US-01…164).
- **Energía y coste** — medición W/kWh y factura estimada (US-181…183).

Todo esto **100% local**, coherente con el egress-filtering y sin puertos expuestos. Esa
combinación —red + planos + presencia + parental, local— **es** el producto. El resto es contexto.

## Clasificación de verticales: core / suficiente / delegado

La decisión operativa es dejar de tratar todas las verticales como igual de importantes:

| Nivel | Qué significa | Verticales |
|---|---|---|
| **Core** | Donde KrakenOS **gana** y se invierte de verdad. Es la razón de instalarlo. | Cobertura WiFi + planos · parental + presencia + bienestar · seguridad de red (inventario/bloqueo/DNS/VLAN/QoS/firewall) · VPN · energía |
| **Suficiente** | Debe existir y funcionar bien, pero **no se persigue paridad** con el líder de esa categoría. | Escenas · automatizaciones «si X→Y» · IoT básico (on/off/brillo/color) · habitaciones/favoritos |
| **Delegado** | Existe best-in-class **gratuito**; competir es malgastar esfuerzo. Se **integra**, no se reimplementa. | **Cámaras avanzadas → Frigate** (US-214): detección ML, pre-roll, NVR · **Voz → Matter** (ya decidido en [`adr-voice.md`](adr-voice.md)): Alexa/Google/Apple controlan dispositivos Matter en LAN |

El detector de movimiento propio (US-186) y la grabación por evento (US-187) quedan como **básico
integrado** para quien no tenga Frigate; en cuanto hay un Frigate, KrakenOS **se aparta** y hereda su
detección (US-214). No se duplica lo que el vecino hace mejor y gratis.

## KrakenOS + Home Assistant: conviven, no compiten

El posicionamiento explícito es **complemento**, no sustituto. La vía es la **interoperabilidad**,
no la absorción:

- **MQTT Discovery** (convención HA, US-213, extiende el `MqttPublisher` de US-174): lo que gestiona
  KrakenOS —luces, enchufes, energía, modo del hogar, alarma, dispositivos online— aparece **solo**
  en Home Assistant, sin mapear topics a mano. Control entrante **opt-in y OFF por defecto**,
  separado de publicar estados.
- El usuario típico de HA gana lo que HA no le da (cobertura, planos, parental, presencia robusta,
  seguridad de red) **sin tener que abandonar HA**. Ese es un mercado de millones de instalaciones,
  no un competidor.

La regla de privacidad de presencia (US-169) se mantiene en la interop: por MQTT viaja **el modo del
hogar, nunca la lista de personas**.

## Honestidad como parte del posicionamiento

Un posicionamiento honesto declara también lo que **no** se es. Se materializa en historias hermanas
de esta fase (S12):

- **Docker es demo/evaluación**, no producción: no opera VPN/firewall/QoS/cámaras/descubrimiento
  (ver [`docker-limitations.md`](docker-limitations.md)). La vía soportada es bare-metal/systemd; el
  instalador de un comando (US-216) será la puerta de entrada recomendada.
- **La alarma no sustituye una alarma certificada** y **el puente Matter tiene fricción de
  certificación** (US-212).
- **La presencia por WiFi tiene un límite físico** (el móvil duerme el WiFi) que se mitiga, no se
  oculta (US-220).
- **La cobertura de tests** del agente se mide con la verdad, no con un 85% decorativo (US-219).

## Decisión y alcance

1. KrakenOS **es** «el cerebro de red del hogar»: complemento local de Home Assistant centrado en la
   cuña red+planos+presencia+parental+seguridad. Se adopta como posicionamiento oficial del producto.
2. Se **clasifican** las verticales en core / suficiente / delegado (tabla de arriba) y se prioriza
   en consecuencia: el esfuerzo va al core; «suficiente» se mantiene; «delegado» se integra.
3. La **interop con Home Assistant** (US-213) es prioridad de mercado, no una feature más.
4. Se **delega** cámaras avanzadas a Frigate (US-214) y voz a Matter (`adr-voice.md`), sin
   reimplementarlas.
5. El README público y el copy de la app se alinean con este posicionamiento (US-211), sin cambios
   funcionales.

## Consecuencias

- **A favor:** deja de competirse en amplitud contra productos imbatibles; el esfuerzo se concentra
  donde KrakenOS es único; el mensaje al mercado se vuelve nítido («¿qué me da esto que HA no?»); la
  interop abre el mercado HA en vez de enfrentarlo.
- **En contra:** se renuncia explícitamente a «ser el hub que lo hace todo»; algunos usuarios querrán
  cámaras/voz nativas y habrá que remitirlos a Frigate/Matter; exige disciplina para no volver a
  perseguir paridad en las verticales «suficiente».

## Reevaluar si…

- La interop con HA (US-213) y el lanzamiento a usuarios reales (US-218) muestran que el mercado
  **no** valora la cuña red+planos (en cuyo caso el problema es más profundo que el posicionamiento), **o**
- Aparece una vía realista de sostenibilidad (caja de hardware, relay propio) que justifique invertir
  en amplitud, **o**
- Un vertical hoy «delegado» deja de tener un best-in-class gratuito (p. ej. Frigate cambia de
  licencia), momento en el que reconsiderar integrarlo vs construirlo.

En cualquiera de esos casos, este ADR se sustituye por uno nuevo con el análisis actualizado.

> Prerequisito transversal de la fase: **US-86** (verificación con hardware real). Cada
> `verified:false` que pase a `true` vale más que cualquier historia nueva.
