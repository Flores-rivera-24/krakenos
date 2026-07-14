# Cobertura honesta (US-99 · US-219)

La CI corre `pnpm test:coverage` (v8). Este documento registra los **números
reales**, las **zonas frías** (qué clase de código queda sin probar y por qué) y
la política de umbrales. La meta no es un porcentaje bonito: es saber qué ramas
de error están sin ejercer y cuáles no son testeables aquí.

## Números reales

**El agente mide con `all: true` (US-219):** cuenta **todo** `src/**`, no solo lo
que los tests importan — incluidos los transportes de hardware que nunca se cargan
aquí. El número refleja la realidad del árbol, no "de lo que se usa, cuánto se
ejerce". Se excluyen solo los dos **entrypoints** con efectos secundarios
(`src/index.ts` arranca/escucha; `src/update-runner.ts` es el proceso actualizador
aparte), no unit-testables sin arrancar el proceso. Sorpresa honesta: medido de
verdad, el árbol está **mejor** cubierto que el 85% decorativo anterior — la suite
ejercita casi todo, y el hardware sin test es una fracción pequeña.

**La web sigue con `all: false`** (mide lo que los tests importan). Migrarla a
`all: true` es deuda aparte (arrastraría muchos componentes de widgets/páginas no
testados; ver la brecha de i18n de widgets del dashboard) — pendiente de una US
futura.

| Paquete | Medición | Statements | Branches | Functions | Lines |
|---------|----------|-----------:|---------:|----------:|------:|
| **agente** (`apps/agent`) | `all: true` | **91.4%** | **85.3%** | **92.4%** | **91.4%** |
| **web** (`apps/web`)      | `all: false` | ~88% | ~79.5% | ~65% | ~88% |

Medido el 2026-07-13 (US-219): agente **1959 tests** (213 ficheros), web **599
tests** (114 ficheros). Suite completa en verde.

## Umbrales en CI: un suelo, no un objetivo

`vitest.config.ts` (agente y web) fija `coverage.thresholds` como **suelo
anti-regresión** ~1–2 pts **por debajo** del número real medido (no un objetivo
decorativo del 85%):

- **agente** (`all: true`): stmts **89** · branches **83** · funcs **90** · lines **89**
- **web** (`all: false`): stmts 85 · branches 78 · funcs **60** · lines 85

Avisan si una rama hoy bien probada deja de estarlo. El margen de ~1–2 pts absorbe
la variabilidad del árbol completo y **no bloquea** por los caminos de hardware
ausentes (abajo, US-86). El suelo de *funciones* de la web es más bajo porque
muchos componentes exponen handlers/callbacks que no todos los tests disparan.

### Plan de subida gradual (agente)

El suelo es de no-regresión, no un techo: cada vez que una tanda añada tests que
suban el número real de forma estable, **subir el suelo detrás** (dejando el
mismo margen de ~1–2 pts). Prioridad al subir: ramas de **riesgo** (auth, update,
egress, integraciones), no relleno. Los transportes de hardware (`*.transport.ts`)
solo suben cuando US-86 aporte verificación real o tests de contrato adicionales;
no forzar test-por-cobertura sobre ellos.

## Zonas frías — por categoría

### 1. No testeables aquí: hardware/IO real → US-86

Sin binarios de red ni root, el transporte real solo se puede verificar en el
despliegue con hardware (`BACKLOG.md → Checklist`). Estos ficheros quedan
deliberadamente fríos (su lógica **pura** —parsers/builders— sí está cubierta):

- **Transportes de driver/IoT/VLAN** (`*.transport.ts`): SSH (`node-ssh`), REST,
  SNMP (`net-snmp`), MQTT/WS. Cobertura 19–52%: el camino feliz mockeado cubre el
  contrato; el manejo real de sockets/timeouts/reconexión va en hardware.
- **`privileged/runner.ts` · `SudoHelperRunner`** (~70%): invoca `sudo` con el
  helper allowlisted; el camino real exige root y el helper instalado (US-86).
- **`config/env.ts`** ramas de TLS/PEM (lectura de cert/clave): dependen de
  ficheros y de variables a nivel de módulo; se ejercen en el arranque real.

> El driver `mock` siempre responde éxito, está siempre online y nunca devuelve
> vacío, así que por sí solo nunca ejerce estos caminos. Para eso existe el
> `FailingDriver` de US-98 (ver abajo).

### 2. Testeables y ahora cubiertas (US-98 + US-99)

Ramas de error que el mock siempre-éxito no tocaba, ya con test dirigido:

- **Frontera del driver** (US-98): respuesta malformada/garbage, timeout, throw y
  vacío en inventario, tráfico y WiFi → saneado/`502 DRIVER_UNAVAILABLE`/anti-flapping.
- **Ciclos de fondo** (US-98): `scanCycle`/`sampleCycle`/`flushCycle` tragan el
  fallo del driver en vez de tumbar el agente por `unhandledRejection`.
- **Handshake de Socket.io** (US-99, `socket-auth.socket.test.ts`): JWT con `type`
  ≠ `access` → `AUTH_INVALID_TOKEN`; token corrupto → `AUTH_UNAUTHORIZED` (catch).
- **`AuthService.refresh`** (US-99, `auth-refresh-errors.test.ts`): refresh con
  firma válida pero sin registro en DB → `AUTH_INVALID_TOKEN`, sin emitir sesión.
- **`/system/connectivity-test`** (US-99, `system-connectivity.routes.test.ts`):
  con `FailingDriver`, las ramas `ok:false` (healthcheck `false`) y `catch`
  (healthcheck lanza) que el mock —siempre `true`— nunca alcanzaba.
- **US-219 (los 2–3 peores huecos de riesgo al pasar a `all: true`):**
  `setup-url.ts::firstLanIpv4` (detección de IP LAN al arranque, mock de
  `os.networkInterfaces`); `update-spawner.ts::createUpdateSpawner` (lanza el
  actualizador **detached** + `unref`, mock de `child_process`, US-190);
  `test-connection.ts::testConnection` (prueba transitoria mock de los 8 dominios
  + dominio desconocido → fallo legible, US-142). +12 tests.

### 3. Frías restantes de bajo riesgo (deuda consciente)

- **`socketio.ts` línea del `setInterval`** de re-verificación (US-80): la lógica
  pura del barrido (`sweepStaleSockets`/`isSocketTokenValid`) está 100% cubierta;
  solo queda sin ejercer el *callback* del temporizador de 30 s (no se espera 30 s
  en test).
- **`json-store.ts`** rama `catch` de `write()` (limpieza de temporal si `rename`
  falla): exigiría mockear `fs` para forzar un fallo de `rename`; el resto
  (corrupción, propagación de E/S, atomicidad, serialización) sí está cubierto.
- **`audit.ts` `defaultSchedule`** (`setTimeout().unref`): trivial; la lógica de
  reintentos/`onGiveUp` de `persistAuditWithRetry` se prueba con scheduler inyectado.
- **Web**: ramas de UI poco frecuentes (algunos estados de error/empty de páginas
  y callbacks de componentes) — de ahí el ~67% de funciones.

## Cómo reproducir

```bash
pnpm -r test:coverage                       # ambos paquetes, con umbrales
pnpm --filter @krakenos/agent exec vitest run --coverage --coverage.reporter=text   # detalle por fichero
```
