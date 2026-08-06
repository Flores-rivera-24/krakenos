# ADR — Control total: KrakenOS contra la app del fabricante (Fase 8)

- **Estado:** Aceptado (2026-07-29) · **ratificado por el dueño y mergeado el 2026-07-30**. Hasta esa
  fecha vivió en la rama `fase8/adr-control-total` **sin mergear**, y la planificación interna bloqueaba la Fase 8
  a la espera de esta lectura. Ese bloqueo queda **levantado**.
- **Sustituye parcialmente a:** [`adr-positioning.md`](adr-positioning.md) — se conserva su tesis
  central («complemento de Home Assistant») y se **revierten** tres decisiones concretas: IoT como
  vertical «suficiente», la interop como exclusivamente saliente, y la opción de convertirse en
  add-on de HA.
- **Origen:** petición explícita del dueño del proyecto (2026-07-29): *«quitar la dependencia real y
  permanente de todas esas apps [SmartThings, Tuya/SmartLife…], que todo se conecte a mi aplicación
  y lo controle desde ahí; que no tenga que batallar para conectar un dispositivo; poder ver qué
  paquetes viajan por mi red; y que sea más segura que esas apps en cada punto que se pueda»*.
- **Base de evidencia:** investigación en 6 frentes con verificación adversarial (2026-07-29).
  9 de 30 afirmaciones fueron refutadas por los jueces y **no** se usan aquí. Los datos de código
  que sostienen la decisión se re-verificaron a mano antes de escribir este documento.

---

## Decisión en una línea

**El enemigo no es Home Assistant: es la app del fabricante.** KrakenOS pasa a ser el sustituto
declarado de SmartLife, Govee Home, Meross, Tapo y SwitchBot — y lo consigue **cambiando de capa**
(protocolo abierto: Matter, Zigbee, MQTT/ESPHome, Shelly, Hue local), no ganando una carrera de
ingeniería inversa contra cinco fabricantes. La interop con HA se mantiene: HA no es el competidor,
es el otro proyecto que quiere matar esas mismas apps.

## Por qué no «ir contra todos»

El deseo original era ir contra HA *y* contra los fabricantes. Se rechaza la primera mitad por tres
razones verificadas:

1. **No es lo que el objetivo exige.** «Que mis cacharros se conecten a mi app» no requiere romper
   con HA. Son objetivos independientes; romper el segundo solo multiplica superficie.
2. **La superficie ya no se sostiene.** La 3ª auditoría midió 13.300 LOC de adaptadores (37 % del
   agente), 30 integraciones, **0 verificadas con hardware** (`verified:false` literal), un
   mantenedor. Añadir un frente es la vía rápida al abandono.
3. **La carrera de ingeniería inversa está perdida de antemano.** LocalTuya —que es exactamente este
   trabajo— tiene 53 contribuidores y 1.565 issues abiertas. Aquí hay uno.

## La reversión, decisión a decisión

| Decisión de `adr-positioning.md` | Qué pasa a ser | Por qué |
|---|---|---|
| §55: IoT es vertical **«suficiente»**, no se persigue paridad | IoT pasa a **core**, acotado por capa física: primera clase = protocolo abierto (Matter, Zigbee/z2m, MQTT/ESPHome/Tasmota, Shelly, Hue, Kasa). Lo que exige nube del fabricante baja a **«community, sin garantía, con fecha de última verificación»** | El objetivo declarado es el control del hogar; IoT ya no puede ser secundario. Pero subirlo a core sin morir exige cambiar de capa, no de esfuerzo |
| §64-70: la interop es **MQTT Discovery saliente**; un consumidor entrante «invertiría la relación» | Se construye un **consumidor MQTT Discovery entrante genérico** (`homeassistant/#`) que da de alta lo que publiquen ESPHome, Tasmota, OpenBeken, Z-Wave JS UI y zigbee2mqtt. **No** se consume HA como fuente | Es el mejor coste/beneficio del análisis: un manager y KrakenOS ingiere cualquier cacharro liberado, sin un backend por marca. Es exactamente donde acaba un Tuya flasheado. El transporte MQTT y el formato ya existen (`ha-discovery.ts`) |
| §56: cámaras → Frigate, voz → Matter | **Se ratifica sin cambios** | «Ver cámaras» ya funciona (HLS propio + Frigate). Nada del pivote justifica reabrir el NVR ni una skill de voz de nube, que rompería el local-first que el propio pivote exige |
| §83-85: el instalador es la puerta de entrada recomendada | **Deja de ser válida sin TLS.** El instalador ofrece la ruta Tailscale (`*.ts.net` con Let's Encrypt) o genera el cert, y avisa por escrito de lo que se pierde sin él | Hoy `install.sh` copia `.env.example` con `HTTPS_ENABLED=false` (`.env.example:211`). Sobre HTTP en una IP de LAN no hay service worker, ni Web Push, ni WebAuthn: el flujo diario en el móvil **no arranca** |
| Bifurcación de producto, opción B: convertirse en add-on de HA | **Descartada por decisión del dueño.** Se anota como coste aceptado, no como opción abierta | No se puede pedir «que se conecten a MI aplicación» y guardar la salida de ser un add-on de la aplicación de otro |
| Congelar el epic de IoT ampliado | **Se descongela parcialmente.** El contrato `climate\|cover\|lock` + `contact\|smoke`) sube a **habilitante** y entra antes que el recorte. El recorte de marcas se mantiene | Recorte y pivote no se contradicen: uno quita marcas, el otro añade categorías. Sin `contact`, un sensor de apertura no genera ningún evento y la alarma está ciega para todo lo que no sea una bombilla |
| §78-90: los cuatro avisos de honestidad | **Se añade un quinto, y va en la UI**, no solo en un doc: «este backend necesita la app del fabricante para el alta» | El mensaje sube de agresividad, así que la honestidad sube en la misma proporción o el primer usuario desmiente el lanzamiento |
| (sin decisión escrita) El repo **no tiene fichero `LICENSE`** | Elegir y commitear una licencia **antes** de la Fase 8 | «Open source mío» hoy es legalmente «todos los derechos reservados», y sin licencia no se puede razonar sobre integrar componentes GPL/AGPL del mundo OpenWrt |

## El muro honesto: la app del fabricante no se puede evitar del todo

Verificado en el propio código y en las fuentes de los proyectos de referencia:

- La `localKey` de un dispositivo Tuya **la emite el emparejamiento contra la nube del fabricante**,
  y **cambia en cada re-emparejamiento**. Lo dice el propio repo: `apps/agent/src/iot/tuya.store.ts:8`
  («la `localKey` … que entrega el portal Tuya Developer»).
- **Corrección importante** (el juez tumbó la versión pesimista): *no* hace falta una cuenta de
  desarrollador. Existen extractores que la sacan con la cuenta normal de SmartLife por login QR, y
  **tuya-cloudcutter** desconecta el aparato de la nube de forma permanente entregando `deviceId` +
  `localKey` sin abrirlo. Lo que sigue siendo cierto es que **la app hace falta una vez**.
- Govee exige activar «LAN Control» aparato por aparato desde su app. El backend de Tapo guarda la
  **contraseña completa de la cuenta TP-Link** (`apps/agent/src/iot/index.ts:101-104`).

**Conclusión operativa:** se puede prescindir de la app **después** de usarla una vez, no antes. La
independencia permanente se compra en la tienda, no en el código: comprando Zigbee/Matter/ESPHome, o
liberando el hardware existente con cloudcutter/OpenBeken (ruta avanzada y destructiva, documentada
como tal, **no** como producto).

## El muro honesto: «modo Wireshark» no es lo que parece

- **Cero ladrillos**: `grep -rniE 'tcpdump|pcap|netflow|sflow|ipfix|conntrack|zeek'` sobre todo el
  árbol → 0 resultados.
- **Topología**: el agente vive *al lado* de la red, no en el camino. El firewall y el QoS actúan
  sobre el `FORWARD` del host del agente (`apps/agent/src/firewall/iptables.helpers.ts:14-21`), que
  en una Pi colgada del router no ve un solo paquete del hogar. Capturar exige segunda NIC o switch
  gestionado con espejo.
- **TLS**: con el 95 % del tráfico cifrado se obtiene IP, ASN, volumen y hora — nunca contenido. Con
  DoH y ECH, ni siquiera el dominio.
- **Coste de operación**: poner el servidor en el camino convierte cada `systemctl restart` del
  actualizador en un corte de internet para toda la casa.
- **Riesgo**: un pcap del hogar sería el fichero más peligroso que este producto haya escrito, y hoy
  no hay ni retención ni cifrado en reposo para algo así.

**Lo que sí se construye** es la versión que responde al 80 % de la pregunta real («¿salió algo de mi
casa y hacia dónde?») sin capturar un paquete: **contabilidad por aparato + histórico DNS cruzado con
el inventario + aviso de destino nuevo**. Se vende como lo que es, no como Wireshark.

> **Nota que corrige una conclusión intuitiva:** el bloqueo *no* es el helper privilegiado. El agente
> ya ejecuta shell arbitrario como root en el router por SSH (`openwrt.transport.ts:82-85`; la guía
> manda usar root). Forzar que todo el hogar pase por Pi-hole (DHCP option 6, o un REDIRECT en el
> gateway) está **sin hacer**, no es imposible.

## Lo que NO se construye, aunque se haya pedido

1. **Captura de paquetes / «modo Wireshark».** Motivos arriba. Lo alcanzable es el epic K5.
2. **Un servidor DNS dentro del agente para «absorber» Pi-hole.** El agente corre con `User=krakenos`
   sin `AmbientCapabilities`: no puede bindear el `:53` sin romper la regla propia «no correr el
   agente como root». Absorberlo es heredar caché, upstreams, DNSSEC, DoH/DoT, DHCP y listas, y
   convertir «no veo el panel» en «no funciona nada en casa». Se controla mejor lo que ya hay.
3. **Nube local propia (fotos/ficheros/streaming).** `install.sh:45` admite máquinas de 900 MB;
   Immich pide 6 GB. Y hay una trampa peor: un panel que muestre Immich «dentro» de KrakenOS hará
   creer que la copia automática protege esas fotos. No las protege. Se **integra** (ingress
   con la sesión existente + tarjeta de estado), no se construye.
4. **Catálogo/app-store de servicios tipo CasaOS o Umbrel.** Mantener el catálogo *es* el producto, y
   es trabajo perpetuo.
5. **Perseguir Tuya/Meross/Govee/Tapo como integraciones de primera.** Se degradan a community con
   fecha de verificación. El esfuerzo va a Zigbee, Matter y MQTT genérico, que es donde el
   emparejamiento **sí** se hace contra el servidor propio.
6. **App nativa para emparejar por Bluetooth desde el móvil.** Web Bluetooth no existe en iOS y no va
   a existir. El emparejamiento se queda en el **servidor** (`src/discovery/` ya está del lado
   correcto) y el móvil confirma.
7. **Canal de notificaciones propio que sustituya a Web Push.** En Android se puede (ntfy/UnifiedPush);
   en iPhone la entrega va por APNs de Apple, punto. Sería medio canal. Telegram y email ya cubren el
   caso «que el aviso no pase por Google» y los envía el servidor.
8. **`tcpdump` en el helper privilegiado.** `tcpdump` no tiene forma fija: `-w` escribe como root
   donde le digas, `-z` ejecuta un comando al rotar, `-r` lee ficheros arbitrarios. Añadirlo a la
   allowlist convierte el helper en escalada a root.

## Deudas que el pivote convierte en bloqueantes

Cinco defectos existentes que hoy son tolerables y con el pivote dejan de serlo:

- **Los ids IoT se re-prefijan al añadir el segundo backend.** `iot/index.ts:168-173` devuelve el
  manager directo con un solo backend y lo envuelve en `CompositeIotManager` a partir de dos, que
  prefija cada id (`composite.iot.ts:47-49`). Esos ids se persisten crudos y **sin FK** en
  `IotRoomMember.iotDeviceId`, `Scene.actions`, `IotSchedule.target`, `Favorite.ref`,
  `EnergySample.deviceId`, `EnergyAlertRule.deviceId` y `alarm.config.sensorDeviceIds`. No existe
  ninguna migración (`grep -rnE 'reprefix|remapId|migrateIotIds'` → 0). **El camino natural del
  usuario —«empiezo con Hue, luego añado los Tapo»— destruye escenas, habitaciones, horarios,
  favoritos y el histórico de energía sin un solo error en pantalla.** Arreglo: prefijar SIEMPRE +
  migración de las 6 tablas. Es prerrequisito de todo lo demás y urge antes de acumular configuración.
- **El backend SwitchBot no puede funcionar.** Pide `/v1.0/devices` a `http://<hub>:8123` con un
  `Authorization` pelado sobre el sobre `{statusCode, body}` (`iot/index.ts:274` +
  `switchbot.transport.ts`): es la API de **nube** v1.0 de SwitchBot con el host cambiado por una IP
  de LAN, y 8123 es el puerto de Home Assistant. No hay API REST local en el Hub Mini ni en el Hub 2.
  Se **borra** (no se arregla) y se documenta «Hub 2 → Matter», que ya funciona con
  `matter.iot.ts:69` sin escribir una línea. Y se corrige `docs/switchbot-setup.md`, que promete «sin
  la app ni la nube» y en el paso 1 manda abrir la app.
- **El estado IoT no llega a la UI.** `IotWatcher.tick()` sondea cada 15 s y hace `bus.publish()` y
  nada más (`automations/iot-watcher.ts:49-57`). Los 6 emisores de `iot:device-updated` son todos de
  origen interno. Encender un foco desde el interruptor de pared no se ve hasta recargar — justo el
  escenario que «reemplazar la app propietaria» exige que funcione.
- **DNS y tráfico por dispositivo los lee cualquier rol autenticado**, incluidos `kid` y `guest`, y
  cualquier token de API con `home.view` (`modules/dns/dns.routes.ts:22,33-39`;
  `modules/traffic/traffic.routes.ts:31-37`). Con histórico DNS eso sería el historial de navegación
  de la familia abierto al invitado, y viajando dentro de la copia cifrada que el usuario puede
  acabar mandando a soporte. **Se arregla antes de persistir un solo registro.**
- **Nueve llamadas salientes se saltan `safeFetch`**, contra el invariante que el propio proyecto
  declara: `pihole.dns.ts:29`, `mikrotik.transport.ts:47`, `hue.transport.ts:24`,
  `omada.transport.ts:32`, `unifi.transport.ts:32`, `pfsense.transport.ts:25`, `asus.transport.ts:23`,
  `switchbot.transport.ts:26-27` y `process-update-runner.ts:124`. Verificado:
  `grep -rln safeFetch apps/agent/src/{iot,dns,drivers}/` → 0 ficheros. El eslogan «más seguro que la
  app del fabricante» no se sostiene con esto abierto.

## Datos externos (weather): decisión

Se permite, **opt-in y declarado**. Open-Meteo autoriza textualmente «utilizing our service for
personal home automation purposes» en su tier gratuito, y la política de egress del proyecto es
LAN-aware, no bloquea APIs públicas. El choque real no es técnico ni legal, es de coherencia:
`homeLatitude`/`homeLongitude` están clasificadas como PII y se **omiten** del bundle de soporte
(`support.service.ts`). Mandarlas a un tercero exige consentimiento explícito y decirlo en voz alta
en la UI, con la opción de redondear la ubicación. Autohospedar Open-Meteo queda descartado: exige
8 GB de RAM mínimo contra los 900 MB del hardware objetivo.

## Consecuencias

- **A favor:** el objetivo del dueño (no volver a abrir la app de Tuya) se vuelve alcanzable por una
  vía sostenible; la ingesta por protocolo sustituye N backends por marca por uno genérico; se
  conserva la interop con HA, que es la única distribución realista para un mantenedor único; y cinco
  bugs latentes que iban a morder justo en el camino del pivote entran al backlog con nombre.
- **En contra:** se acepta que el parque WiFi propietario actual exige la app al menos una vez, y que
  la independencia total se compra cambiando hardware; se renuncia a la captura de paquetes; se
  renuncia a la salida «convertirse en add-on de HA»; y la superficie crece en categorías (climate,
  cover, lock, contact, smoke) justo cuando la auditoría pedía recortarla — el recorte por marcas es lo que paga esa cuenta.

## Reevaluar si…

- La primera tanda de **verificación con hardware real** revela que los backends degradados a «community»
  fallan más de lo previsto → adelantar el borrado en vez de la degradación.
- El usuario decide **no** cambiar hardware hacia Zigbee/Matter → entonces el pivote se reduce a
  «gestionar bien lo propietario» y este ADR se rebaja a mejora de UX, porque la independencia
  permanente deja de ser alcanzable.
- La ingesta MQTT entrante (K4) resulta ser el 90 % del valor → replantear si los backends por marca
  tienen futuro alguno más allá de Hue, Shelly y Kasa.

> Relacionados: [`adr-positioning.md`](adr-positioning.md) (lo que se conserva) ·
> [`adr-distribution.md`](adr-distribution.md) · [`interop.md`](interop.md) ·
> La verificación con hardware real sigue siendo el prerrequisito transversal (prerrequisito
> transversal: los cinco hallazgos graves de este análisis salieron de leer código, no de ejecutarlo).
