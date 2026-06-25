# Cobertura honesta (US-99)

La CI corre `pnpm test:coverage` (v8). Este documento registra los **números
reales**, las **zonas frías** (qué clase de código queda sin probar y por qué) y
la política de umbrales. La meta no es un porcentaje bonito: es saber qué ramas
de error están sin ejercer y cuáles no son testeables aquí.

## Números reales (medidos con `all: false`)

`all: false` mide solo los ficheros que los tests importan, no el árbol entero;
así el porcentaje refleja "de lo que se usa, cuánto se ejerce", sin inflar ni con
entrypoints de efectos secundarios ni con ficheros de hardware que nadie carga.

| Paquete | Statements | Branches | Functions | Lines |
|---------|-----------:|---------:|----------:|------:|
| **agente** (`apps/agent`) | ~88.7% | ~84.4% | ~87.2% | ~88.7% |
| **web** (`apps/web`)      | ~88.7% | ~83.6% | ~67.0% | ~88.7% |

Tests tras US-99: **963 agente + 251 web = 1214** (US-98 dejó el agente en 958;
US-99 suma 5 tests dirigidos a ramas de error). Suite completa en verde.

## Umbrales en CI: un suelo, no un objetivo

`vitest.config.ts` (agente y web) fija `coverage.thresholds` **por debajo** de los
números reales:

- **agente**: stmts 85 · branches 80 · funcs 83 · lines 85
- **web**: stmts 85 · branches 78 · funcs **60** · lines 85

Son un **suelo anti-regresión**: avisan si una rama hoy bien probada deja de
estarlo, no persiguen subir el porcentaje. Se fijan holgados a propósito para que
**no bloqueen** por los caminos de hardware ausentes (abajo) ni por la
variabilidad de `all: false`. El suelo de *funciones* de la web es más bajo
porque muchos componentes exponen handlers/callbacks que no todos los tests
disparan (un valor real ~67%).

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
