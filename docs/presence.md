# Presencia por WiFi: límite físico y mitigaciones

KrakenOS deriva la presencia («¿quién está en casa?») de la señal WiFi de los dispositivos
personales de cada persona (`Device.ownerId`), **sin geofence ni nube**. Es privado y local, pero
tiene un **límite físico** que conviene conocer.

## El límite

Los móviles **duermen el WiFi** para ahorrar batería: un iPhone o Android en reposo profundo puede
soltar la red 5–15 minutos (típico de madrugada). Para KrakenOS, ese dispositivo «desaparece» de la
red aunque la persona siga en casa. Sin mitigación, eso produciría **salidas falsas** («se fue de
casa» a las 3 AM) que romperían las automatizaciones y el auto-armado de la alarma.

La **llegada** no sufre este problema: el primer dispositivo que vuelve a la red marca la llegada al
instante. El problema es solo la **salida**.

## Mitigaciones (todas locales)

KrakenOS confirma una salida solo cuando se cumplen **todas** estas condiciones:

1. **Ventana de gracia** (`presenceGraceMin`, por defecto 10 min): quedarse sin señal no marca la
   salida al momento; arma una salida **pendiente** que el barrido confirma pasado este tiempo.
2. **Histéresis de barridos** (`presenceLeaveSweeps`, por defecto 2): además de la gracia,
   se exigen **N barridos consecutivos** que re-confirmen el offline contra la base de datos. Si el
   dispositivo reaparece en cualquier barrido, se **rompe la racha** y no hay salida.
3. **Supresión nocturna** opcional (`presenceNightSuppress`, p. ej. `23:00-07:00`): dentro de
   esa franja, una desaparición WiFi **no** confirma la salida (el patrón real del sueño del móvil).
   Vacío = desactivada. Cruza medianoche.

Todo se configura en **Ajustes → Sistema** (admin).

## Señal de confianza

La API de presencia (`GET /api/presence`, **acotada por rol**) marca cada persona con `signal`:

- `fresh` — su dispositivo responde ahora.
- `stale` — se le mantiene «en casa» pero su WiFi dejó de responder (salida pendiente de confirmar).

El propio usuario ve su señal débil en el widget de **Modo del hogar**. Por privacidad, la
señal y la lista de personas **nunca** viajan por el socket broadcast: solo por la API acotada por
rol. El auto-armado de la alarma se dispara por el modo `away`, que solo se alcanza tras
confirmar la salida con las mitigaciones de arriba → **una falsa desaparición nocturna no arma la
casa**.

## Camino futuro (no construido)

La vía WiFi es «suficiente» para el hogar, pero no perfecta. Mejoras posibles, **como referencia**,
no comprometidas:

- **App companion** que reporte presencia por geofence del sistema operativo (rompería «sin app
  propia»; se evaluaría con su propio ADR).
- **BLE** (balizas Bluetooth) para presencia por habitación, más granular que el WiFi.

Ninguna se implementa ahora: aumentarían la superficie y la fricción sin evidencia de que el hogar
las necesite. Se reabren si los usuarios reales lo piden.
