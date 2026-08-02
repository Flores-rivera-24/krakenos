# ADR — Cerraduras: se leen y se cierran; abrir no se construye

- **Estado:** Aceptado (2026-08-02)
- **Contexto:** el contrato IoT reconoce la categoría `lock` desde que se amplió con climatización,
  persianas, cerraduras y sensores, y **tres** backends la reportan ya: zigbee2mqtt, la ingesta
  genérica por MQTT Discovery y Matter. Ninguno la escribe. Esa ausencia no era una decisión: era un
  hueco, y un hueco se rellena solo el día que alguien añade una línea sin darse cuenta de lo que
  está decidiendo.
- **Por qué exige ADR y no un `TODO`:** la superficie que falta abre la puerta de la calle. El coste
  de equivocarse no se parece al de ninguna otra escritura del producto —una luz encendida por error
  es una molestia; una puerta abierta por error es un robo— y la decisión no se puede tomar en la
  revisión de un pull request de otra cosa.

---

## Decisión en una línea

**Una cerradura se lee y se puede cerrar; abrirla no se construye.** No es «todavía no»: es que la
superficie de desbloqueo **no existe** —ni endpoint, ni campo en el contrato, ni acción de
automatización, ni entidad controlable en Home Assistant, ni endpoint del puente Matter— y lo ata un
gate que recorre esas seis superficies.

## La asimetría, que es todo el argumento

Cerrar y abrir parecen la misma operación con un booleano distinto. No lo son:

| | Echar la llave | Abrir |
|---|---|---|
| Peor caso de un fallo | Encuentras la puerta cerrada y la abres con tu llave | **Cualquiera entra en tu casa** |
| Peor caso de un ataque | Molestia | Robo, sin forzar nada y sin rastro físico |
| ¿Se puede deshacer desde fuera? | Sí, con la llave de siempre | No hay nada que deshacer: ya han entrado |
| ¿Necesita que estés presente? | No | Sí, y no hay forma de comprobarlo por software |

El producto ya tomó exactamente esta decisión una vez y funcionó: **armar la alarma no pide PIN y
desarmarla sí**. La simetría aparente de un interruptor esconde una asimetría real de consecuencias,
y en los dos casos la respuesta es la misma — el lado peligroso se protege aparte.

## Por qué «no se construye» y no «se construye con PIN»

La alternativa seria era permitir el desbloqueo detrás de un segundo factor: PIN propio con bcrypt y
bloqueo por intentos, como el desarme de la alarma (`auth/attempt-lockout.ts`), fuera de los tokens
de API y del control entrante por MQTT. Es implementable y no es absurdo. Se descarta **hoy** por
tres razones concretas, no por prudencia genérica:

1. **Cero verificación con hardware.** Ninguna de las integraciones del proyecto se ha ejercitado
   contra un aparato real: el mapeo de cerraduras de Matter sale de la especificación y el de
   zigbee2mqtt de su documentación. Estrenar la ruta de escritura más peligrosa del producto sobre
   un mapeo que **nunca ha visto un cerrojo** es exactamente el orden equivocado. Una cerradura es el
   último sitio donde se descubre que un valor estaba invertido — y este proyecto ya ha encontrado
   esa inversión **tres veces** (el contacto de zigbee2mqtt, el estado booleano de Matter y la
   posición de las persianas, que mide cierre y no apertura).
2. **El segundo factor no responde a la pregunta que importa.** Un PIN demuestra que quien pide la
   apertura conoce el PIN, no que esté delante de la puerta. Contra el escenario que preocupa —una
   sesión robada, un token filtrado, un broker MQTT comprometido, una regla de automatización mal
   escrita— un PIN guardado en el mismo servidor añade menos de lo que parece.
3. **Nadie lo ha pedido y ya existe la alternativa.** Quien quiera abrir su puerta desde el móvil
   tiene la app del fabricante de la cerradura, que es el único sitio donde ese riesgo está asumido
   por quien lo fabricó y certificado por alguien. Este proyecto declara que sustituye a esa app
   para luces, enchufes, sensores y clima; **decir en voz alta que para la cerradura no** es más
   honesto que hacerlo a medias.

## Lo que SÍ se construye: cerrar

Echar la llave es fail-safe y tiene casos de uso reales que hoy no se pueden cubrir: «al pasar la
casa a modo Fuera, cierra», «a la hora de dormir, cierra». Entra como **acción propia**, no como un
booleano del estado:

- `POST /api/iot/devices/:id/lock` — **no existe** `/unlock`. La ausencia del camino es la garantía;
  un booleano `locked: false` sería la misma superficie con otro nombre.
- Capacidad `home.control` (admin y member), **auditada** con actor e IP.
- **Fuera de `API_TOKEN_SCOPES`**: ni un token emitido por un admin cierra una puerta, por el mismo
  criterio con el que quedaron fuera las cámaras y la actividad por aparato.
- `lock` **sigue fuera** de `CONTROLLABLE_IOT_KINDS`: esa lista gobierna `setState`, que es la vía
  genérica por la que pasan escenas, automatizaciones y el control entrante de Home Assistant.

> ⚠️ **Se construye cuando haya una cerradura delante**, no antes. Este ADR fija la política; la
> implementación va con la verificación de hardware pendiente, y hasta entonces la categoría sigue
> siendo de solo lectura. Escribir hoy el camino de cierre contra un mapeo sin verificar repetiría
> el error que este mismo documento usa como argumento.

## Las seis superficies, y quién las vigila

La decisión no se sostiene con este documento: se sostiene con un gate que recorre **todos** los
sitios por los que una orden puede llegar a un aparato (`test/unit/cerraduras.test.ts`). Ese es el
patrón que el proyecto ya paga por haber aprendido: un invariante sobre «todos los X» enumerado a
mano sale corto — pasó con las peticiones salientes, que se contaron mal en dos auditorías seguidas.

| Superficie | Qué la cierra |
|---|---|
| Contrato (`setState`) | `lock` fuera de `CONTROLLABLE_IOT_KINDS`; sin campo `locked` en `UpdateIotStateRequest` |
| Borde HTTP | El cuerpo de `PATCH /api/iot/devices/:id` no admite `locked` (`additionalProperties: false`) |
| Automatizaciones y escenas | Pasan por `setState`, así que heredan el guard del contrato |
| Interop con Home Assistant | Una cerradura se publica como `binary_sensor` de solo lectura, **sin `command_topic`**, incluso con el control entrante activo |
| Puente Matter (voz) | `endpointTypeFor` solo mapea `plug` y `light`: una cerradura no llega a Alexa, Google ni Apple |
| Cada backend IoT | Todos validan con `isControllableKind`, no con una lista propia |

**Un agujero encontrado al escribir esto:** el backend de zigbee2mqtt era el único que no validaba
contra el contrato —rechazaba `kind === 'sensor'` y nada más—, así que aceptaba una orden sobre una
cerradura y publicaba `{"state":"OFF"}` en su topic. Que zigbee2mqtt espere ahí `LOCK`/`UNLOCK` y
probablemente descarte ese valor **no es una defensa**: es depender de cómo esté escrito el conversor
de un tercero para que no se abra una puerta. Corregido con este ADR, y el gate impide que vuelva.

## Lo que NO se construye, aunque parezca gratis

1. **Desbloqueo por voz** a través del puente Matter. Un asistente de voz oye a cualquiera que grite
   desde la ventana.
2. **Desbloqueo por automatización o escena.** «Cuando llego a casa, abre» convierte la presencia por
   WiFi —que este mismo proyecto documenta como aproximada, con histéresis y supresión nocturna
   porque el móvil duerme la radio— en la llave de la puerta.
3. **Desbloqueo por token de API.** Los tokens no administran, y esto está por encima de administrar.
4. **Desbloqueo desde el control entrante de MQTT.** El broker **no tiene sujeto**: cualquiera con
   sus credenciales publica en cualquier topic.
5. **Un botón «abrir» que pida confirmación en la UI.** Un diálogo protege de un despiste, no de un
   atacante, y deja el endpoint construido — que es lo único que importa aquí.

## Consecuencias

- **A favor:** la ruta de escritura con peores consecuencias del producto no existe, y su ausencia es
  verificable en vez de confiada. La categoría sigue siendo útil (saber si la puerta está cerrada
  vale por sí solo, y encaja con la alarma y los avisos). Y se cierra un agujero real en el backend
  de zigbee2mqtt que nadie había mirado.
- **En contra:** KrakenOS no sustituye a la app de la cerradura y hay que decirlo en el catálogo de
  compatibilidad, no dejar que el usuario lo descubra. Quien quiera «abrir al llegar» seguirá
  necesitando otra app. Y cuando se implemente el cierre, habrá que sostener una acción de API que
  no se parece a ninguna otra del módulo IoT.

## Reevaluar si…

- **La verificación con hardware entrega una cerradura real** y su mapeo de estado resulta correcto
  durante un tiempo razonable: entonces el cierre (`lock`) se implementa, y solo entonces tiene
  sentido volver a discutir la apertura.
- **Aparece un factor que demuestre presencia física** y no solo conocimiento de un secreto (NFC
  contra el propio aparato, un botón físico, una passkey con verificación de usuario en el móvil que
  está en casa): ese sí cambia el argumento, porque ataca la razón por la que un PIN no basta.
- **El usuario decide asumir el riesgo explícitamente.** Es su casa: si lo pide sabiendo lo que
  significa, este ADR se sustituye por otro que escriba las condiciones —segundo factor propio,
  fuera de tokens, fuera de MQTT, fuera de automatizaciones— en vez de abrir la vía por omisión.

> Relacionados: [`adr-control-total.md`](adr-control-total.md) (qué se sustituye y qué no) ·
> [`adr-ingesta-mqtt.md`](adr-ingesta-mqtt.md) (la escritura en cerraduras ya quedó fuera de la
> ingesta) · [`threat-model.md`](threat-model.md) · [`interop.md`](interop.md).
