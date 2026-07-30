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

**La web también mide con `all: true` desde US-230.** Era deuda declarada… hasta que
la 3ª auditoría la midió: con `all: true` ya pasaba el umbral, así que el `all: false`
no era deuda, era **inercia**. Se excluyen solo los entrypoints (`main.tsx`,
`vite-env.d.ts`), misma política que el agente.

| Paquete | Medición | Statements | Branches | Functions | Lines |
|---------|----------|-----------:|---------:|----------:|------:|
| **agente** (`apps/agent`) | `all: true` | **92.00%** | **86.27%** | **91.11%** | **92.00%** |
| **web** (`apps/web`)      | `all: true` | 88.28% | 79.84% | **65.99%** | 88.28% |

Medido el 2026-07-29 (tras US-231): agente **2291 tests** (240 ficheros), web **631
tests** (119 ficheros). Suite completa en verde.

> ⚠️ **El número de statements de la web está inflado y conviene saberlo.** Los
> catálogos i18n (`lib/i18n/catalog/`) y las 25 guías del asistente (`lib/guides/`)
> son `export const` de **texto**: v8 los marca como cubiertos solo con importarse.
> **El número que dice la verdad sobre la web es el de funciones (~66 %)**, que mide
> handlers y callbacks realmente disparados. Por eso su suelo se sube aparte y el
> aviso está también en `apps/web/vitest.config.ts`. No se excluyen esos ficheros
> para no desviarse de la política del agente («solo entrypoints»), pero al leer el
> 88 % hay que descontarlos mentalmente.

Entrypoints excluidos (efectos secundarios, no unit-testables sin arrancar el
proceso): `src/index.ts`, `src/update-runner.ts` y `src/reset-admin.ts` (US-233).
La lógica de los dos últimos sí se prueba, en `system/update-lock.ts`,
`system/process-update-runner.ts` y `system/admin-reset.ts`.

## Umbrales en CI: un suelo, no un objetivo

`vitest.config.ts` (agente y web) fija `coverage.thresholds` como **suelo
anti-regresión** ~1–2 pts **por debajo** del número real medido (no un objetivo
decorativo del 85%):

- **agente** (`all: true`): stmts **89** · branches **83** · funcs **90** · lines **89**
- **web** (`all: true`, US-230): stmts 85 · branches 78 · funcs **64** · lines 85

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
