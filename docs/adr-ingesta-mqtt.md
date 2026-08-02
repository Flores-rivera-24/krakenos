# ADR — Ingesta por MQTT Discovery: consumir el protocolo, no Home Assistant (US-248)

- **Estado:** Aceptado (2026-08-01)
- **Contexto de la decisión:** [`adr-control-total.md`](adr-control-total.md) revierte la postura de
  «la interop es solo saliente» y encarga **un consumidor MQTT Discovery entrante genérico** como la
  pieza de mejor coste/beneficio del pivote: un manager y KrakenOS ingiere cualquier cacharro
  liberado, sin escribir un backend por fabricante. Es exactamente donde acaba un Tuya flasheado.
- **Por qué exige ADR propio:** la línea entre «consumir un protocolo» y «consumir Home Assistant»
  es fina, y cruzarla sin darse cuenta convertiría a KrakenOS en un cliente de HA — justo lo
  contrario de lo que el pivote pide. El `adr-positioning.md` original rechazaba el consumidor
  entrante con ese argumento («invertiría la relación»), así que la reversión tiene que decir **por
  qué esta vez no la invierte**, y dejarlo comprobable.

---

## Decisión en una línea

Se construye el backend IoT **`mqtt`**: se suscribe al namespace de anuncio (`homeassistant/#` por
convención) y da de alta lo que publiquen **los propios aparatos** —ESPHome, Tasmota, OpenBeken,
Z-Wave JS UI, zigbee2mqtt—. Se consume **la convención**, que es un formato público de anuncio de
dispositivos; **no** se consume Home Assistant, que es otro consumidor del mismo namespace.

## Por qué esto NO invierte la relación con Home Assistant

La objeción de `adr-positioning.md` §64-70 daba por hecho que un consumidor entrante leería de HA.
No es lo que ocurre aquí, y la diferencia es de hecho verificable, no de intención:

| | Consumir el protocolo (lo que se hace) | Consumir HA (lo que no) |
|---|---|---|
| Quién publica | **El aparato**, retenido, en su propio arranque | HA, exportando su estado |
| Qué se lee | `homeassistant/<componente>/…/config` + los topics que **el aparato declara** | La API REST/WebSocket de HA, o su `states` |
| Si HA no existe | **Funciona igual**: el namespace lo llena el aparato | No hay nada que leer |
| Quién es la fuente de verdad del hogar | KrakenOS | HA |
| Dirección del dato | Aparato → KrakenOS | HA → KrakenOS |

El nombre `homeassistant/` es un accidente histórico de la convención (la inventó ese proyecto y el
ecosistema la adoptó); el prefijo es **configurable** y ni el consumidor ni sus parsers saben que HA
existe. Que HA esté suscrito al mismo namespace no lo convierte en intermediario: los dos son
lectores de un anuncio que hace un tercero.

**Regla operativa que lo mantiene cierto:** si algún día hace falta leer algo que solo HA publica
—su registro de entidades, sus áreas, su `states`— eso **no** entra por aquí; exige un ADR nuevo,
porque sí invertiría la relación.

## El bucle que había que cerrar antes de escribir una línea

KrakenOS **ya publica** en ese mismo namespace desde US-213 (`homeassistant/<componente>/krakenos/
<objeto>/config`). Contra el broker de casa —que es el caso normal, porque es el mismo broker— un
consumidor ingenuo se ingiere a sí mismo:

- cada aparato aparecería **dos veces**, una real y otra `mqtt:…`;
- la energía se contaría **por duplicado**;
- y encender la copia publicaría en **nuestro propio `command_topic`**, cerrando un bucle de órdenes
  con el anti-bucle de automatizaciones (US-167) fuera de juego, porque para el motor sería un
  aparato distinto.

Se excluye por **tres** señales (nodo `krakenos`, `unique_id` con prefijo `krakenos_`, identificador
de aparato con ese prefijo) y lo ata un test que alimenta al consumidor con la **salida real del
publicador**: si un día cambia el formato de US-213, el test lo caza antes que producción.

## La plantilla que no se ejecuta

El formato admite **plantillas Jinja2** (`value_template`) para extraer un valor de un payload JSON,
y Tasmota y Z-Wave JS UI las usan siempre. Interpretarlas de verdad significaría **ejecutar código
de terceros llegado por la red** dentro del agente: el broker no tiene sujeto, así que quien tenga
sus credenciales elegiría qué se evalúa.

**Decisión:** se soporta un **subconjunto declarado y cerrado** —`{{ value }}` y rutas sobre
`value_json` (`{{ value_json.ENERGY['Power'] }}`)—, que es la forma que cubre el parque real. Lo que
no encaja se marca `no-soportada`: el aparato **se sigue listando** y esa lectura queda vacía. No se
inventa un valor y no se ejecuta nada.

Es la misma familia de decisión que el resto del proyecto: una capacidad que no existe **se
declara**, no se deduce de un hueco (US-263).

## Lo que NO se construye

1. **Un intérprete de Jinja2.** Ver arriba.
2. **Lectura de la API de Home Assistant** (REST o WebSocket). Sería el cruce de la línea.
3. **Publicar en el namespace de discovery** desde este backend. Solo se **lee**; lo que KrakenOS
   anuncia lo sigue haciendo el publicador de US-213, con su propio toggle.
4. **Componentes fuera del contrato IoT** (`fan`, `vacuum`, `number`, `select`, `siren`, `button`…).
   Se ignoran en silencio en vez de mapearlos a la fuerza: un ventilador expuesto como enchufe
   miente sobre lo que hace. Cuando el contrato crezca, crecerá el mapeo.
5. **Escritura en cerraduras.** `lock` se lee y no se escribe (US-244); abrir la puerta de la calle
   por API es la decisión de **US-246**, no un efecto colateral de esta ingesta.
6. **Descubrir el broker solo.** La URL la pone el usuario. Sondear la LAN buscando brokers sería
   una sonda activa nueva, y `src/discovery/` tiene sus propias reglas (US-175).

## Seguridad: el broker no tiene sujeto

Es el mismo principio que US-236 aplicó al control entrante, ahora en la dirección de la lectura:
cualquiera con credenciales del broker puede publicar una config.

- **Tope de entidades** (500 por defecto) y **de tamaño de payload** (32 KB): la memoria del agente
  no se le fía a un publicador cualquiera. Al llegar al tope **se avisa** en el log, porque un
  recorte silencioso se ve igual que media casa que no aparece.
- **Nada se ejecuta** a partir del payload (ver plantillas), y las órdenes salientes van **solo** a
  los topics que el propio aparato declaró: no se compone ninguno.
- El backend es **opt-in** como todos: sin `IOT_KIND=mqtt` (o su alta en Conectar) no se abre ni la
  conexión.
- Un aparato ingerido **no gana privilegios**: entra por el mismo contrato `IotManager` que el
  resto, con sus mismas cotas (`withActionTimeout`, lotes acotados).

## Consecuencias

- **A favor:** el parque «liberado» (ESPHome, Tasmota, OpenBeken) deja de necesitar un adaptador por
  marca, que es la única forma sostenible de subir IoT a core con un mantenedor único. Un Tuya
  flasheado con cloudcutter aterriza aquí sin escribir código. Y la ingesta reutiliza el transporte
  MQTT y el contrato ampliado de US-244, así que trae persianas, termostatos y sensores, no solo
  luces y enchufes.
- **En contra:** se añade superficie justo después de una fase de recorte —el precio ya lo declara
  `adr-control-total.md`—; el color no se mapea en este baseline; y los aparatos cuya plantilla no
  encaje se verán sin lecturas hasta que alguien amplíe el subconjunto. Además, el estado depende de
  **retenidos**: un broker configurado sin `retain` en los aparatos dará una casa vacía hasta que
  cada uno publique, y eso es del broker, no de KrakenOS.
- **Sin verificar con hardware real** (US-86): probado contra el formato documentado y contra la
  salida real de nuestro propio publicador, **no** contra un ESPHome ni un Tasmota físicos. Es la
  misma reserva que arrastran las demás integraciones y la primera instalación real es la que manda.

## Reevaluar si…

- **La ingesta genérica resulta ser el 90 % del valor** (señal que el propio `adr-control-total.md`
  nombra): entonces toca replantear si los backends por marca tienen futuro más allá de Hue, Shelly
  y Kasa, y este ADR se sustituye por el plan de recorte.
- **Aparecen plantillas que el subconjunto no cubre en aparatos comunes**: se amplía el subconjunto
  con formas nuevas **declaradas**, nunca con un evaluador genérico.
- **Alguien pide leer de HA de verdad** (áreas, entidades, `states`): ADR nuevo, porque esa sí es la
  inversión de la relación que este documento evita.

> Relacionados: [`adr-control-total.md`](adr-control-total.md) (el pivote que lo encarga) ·
> [`adr-positioning.md`](adr-positioning.md) (la decisión que revierte) ·
> [`interop.md`](interop.md) (la dirección saliente, US-213/236) ·
> [`mqtt-discovery-setup.md`](mqtt-discovery-setup.md) (cómo se usa).
