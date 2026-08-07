# Calidad: qué se prueba, con qué, y qué número es honesto

Este documento es el mapa de la estrategia de pruebas de KrakenOS. Responde a tres
preguntas y no a más: **qué disciplina cubre cada herramienta**, **cómo se ejecuta**
y **qué significa cada número**.

Regla que ordena todo lo de abajo: **un número que no puede bajar no vigila nada**.
Un umbral se pone donde duele si hay regresión, no donde siempre pasa.

---

## Mapa de disciplinas

| Disciplina | Herramienta | Dónde vive | ¿Bloquea CI? |
| --- | --- | --- | --- |
| Unitarias | Vitest | `apps/*/test/unit` | Sí |
| Integración (API + DB) | Vitest + Fastify `inject` | `apps/agent/test/integration` | Sí |
| Tiempo real | Vitest + socket.io-client | `apps/agent/test/realtime` | Sí |
| Componentes y stores | Vitest + Testing Library | `apps/web/test` | Sí |
| Sistema / E2E | Playwright | `e2e/tests`, `e2e/tests-en` | Sí |
| E2E de montaje (dev/prod) | Playwright | `e2e/stacks` | No (bajo demanda) |
| Aceptación | E2E escritos por historia | `e2e/tests` | Sí |
| Regresión | Toda la suite + *gates* estructurales | — | Sí |
| Estructurales (caja blanca) | Barridos sobre la tabla de rutas real | `apps/agent/test/integration` | Sí |
| Mutación | Stryker | `apps/agent/stryker.config.json` | Sí |
| Rendimiento (carga) | autocannon | `scripts/qa/perf-api.mjs` | No (bajo demanda) |
| Rendimiento (tamaño) | Presupuesto de bundle | `apps/web/scripts/bundle-budget.mjs` | Sí |
| Seguridad — secretos | gitleaks | CI | Sí |
| Seguridad — SAST | semgrep | CI | Sí |
| Seguridad — dependencias | OSV | `scripts/audit-osv.mjs` | Sí (críticas de producción) |
| Seguridad — shell que corre como root | shellcheck | CI | Sí |
| Seguridad — autorización | Barridos de authz | `apps/agent/test/integration` | Sí |
| Usabilidad / accesibilidad (navegador) | axe-core + Playwright | `e2e/tests/a11y.spec.ts` | Sí |
| Accesibilidad (componentes) | jest-axe | `apps/web/test/a11y` | Sí |
| Accesibilidad (paleta) | Medidor de contraste | `apps/web/scripts/check-contrast.mjs` | Sí |
| Compatibilidad (motor) | Playwright Chromium · Firefox opt-in | `e2e/` | Chromium sí |
| Compatibilidad (idioma) | Proyecto `chromium-en` | `e2e/tests-en` | Sí |
| Portabilidad (instalación) | Smoke del instalador en Debian limpio | CI | Sí |
| Mantenibilidad | knip | `knip.json` | No (bajo demanda) |
| Fiabilidad | Reintentos, *timeouts*, cuarentena explícita | `e2e/playwright.config.ts` | Sí |

---

## Cómo se ejecuta

```bash
pnpm qa               # lint + typecheck + tests con cobertura + mutación + código muerto
pnpm test:coverage    # unitarias + integración + componentes, con cobertura
pnpm test:e2e         # sistema, aceptación y accesibilidad en navegador
pnpm qa:mutation      # ¿los tests DETECTAN el fallo, o solo pasan por la línea?
pnpm qa:perf          # latencia y throughput de la API contra presupuesto
pnpm qa:deadcode      # ficheros, exports y dependencias que ya no usa nadie
pnpm qa:compat        # la suite E2E en Firefox (requiere `pnpm qa:compat:install`)
```

Los informes se escriben en `qa-reports/`, que está gitignored: son resultados de una
ejecución concreta, se regeneran, y cambian de una máquina a otra. Lo que sí se
versiona es el **umbral** que deben superar, en la config de cada herramienta.

### Requisito del entorno para E2E

Los navegadores de Playwright necesitan librerías del sistema (`libnspr4`,
`libnss3`, `libasound2`). Se instalan una vez con:

```bash
sudo pnpm exec playwright install --with-deps chromium
```

Sin ellas el navegador ni arranca y **la suite entera falla en el primer test**, con
un error de `browserType.launch` que no se parece en nada a un fallo de la
aplicación. Si no hay `sudo`, se pueden descargar los `.deb` (`apt-get download`),
extraerlos con `dpkg -x` a un directorio y apuntar `LD_LIBRARY_PATH` ahí.

---

## Qué significa cada número

### Cobertura — mide ejecución, no comprobación

Las cotas de `vitest.config.ts` son un **suelo anti-regresión**, no un objetivo: se
fijan 1–2 puntos por debajo de lo medido para que una bajada real rompa el build.
Los valores vigentes están en `docs/coverage-notes.md`.

Dos avisos de honestidad que ya están escritos en las configs y conviene repetir:

- En la web, **el número que dice la verdad es el de funciones**, no el de líneas.
  Los catálogos de traducción y las guías son `export const` de texto que el
  instrumentador marca como cubierto con solo importarlos, e inflan líneas y
  sentencias.
- Cobertura alta **no** implica tests buenos. Una línea puede ejecutarse en cada test
  sin que nadie compruebe su resultado. Eso lo mide la mutación, no la cobertura.

### Mutación — mide si los tests DETECTAN el fallo

Stryker cambia el código a propósito (un `>` por `>=`, un `&&` por `||`) y comprueba
si algún test se entera. Un mutante que **sobrevive** es una línea que los tests
ejecutan pero no vigilan.

Está acotado a la **lógica pura crítica** —autorización por rol, tokens de API,
lockout anti-fuerza-bruta y la máquina de estados de la alarma— por dos razones: es
donde un falso verde sale más caro, y son módulos sin base de datos, así que la
campaña entera tarda unos 15 segundos. La lista está en `stryker.config.json`.

Corre con su propia config de Vitest (`vitest.mutation.config.ts`) que solo incluye
los tests de esos módulos. Sin acotar, Stryker re-ejecutaría los ~5 minutos de suite
del agente **por cada mutante**. Al añadir un módulo a `mutate`, hay que añadir su
test a esa config: si no, sus mutantes salen todos como «sin cobertura» y el informe
miente en la dirección contraria.

Umbral de ruptura: **75 %**.

Al leer el informe, cuidado con los **mutantes equivalentes**: cambios que no alteran
el comportamiento y que por tanto ningún test puede matar. En el lockout, por
ejemplo, `.toLowerCase()` → `.toUpperCase()` sobrevive porque ambas normalizan igual
de bien. Perseguirlos no mejora nada. Escribe tests de **contrato** —el borde exacto,
el instante justo de expiración—, no tests que persigan la expresión concreta que
Stryker tocó.

### Rendimiento — mide regresión, no capacidad

`pnpm qa:perf` levanta el agente construido con los gestores en mock y lanza carga
contra cinco rutas representativas. Cada una tiene presupuesto de latencia p99 y de
throughput mínimo, fijados en ~4× / ~¼ de lo **medido** (los valores de referencia
están en el propio script, en el campo `medido`).

Es una medida **relativa**: corre en la máquina de quien lo ejecuta y con mocks en
vez de hardware real. Sirve para cazar una consulta N+1 nueva o un JSON sin paginar;
**no** es una promesa de capacidad. Por eso no bloquea CI: en un *runner* compartido
un presupuesto de latencia produce rojos que no son del código, y un gate que falla
solo enseña a ignorar el rojo.

### Accesibilidad — dos capas que miden cosas distintas

| | `apps/web/test/a11y` (jsdom) | `e2e/tests/a11y.spec.ts` (navegador) |
| --- | --- | --- |
| Qué monta | Cada página suelta | La app entera, navegada |
| Contraste | **No puede medirlo** (sin cascada de estilos) | Sí, sobre lo pintado |
| Landmarks y orden de encabezados | Desactivado (falsos positivos) | Sí |
| Velocidad | Segundos | ~40 s |

La de navegador **debe esperar a que la página esté pintada** antes de medir. No es
una precaución de manual: sin esperar, axe analiza los esqueletos de carga
(`.kr-shimmer`) y compone el texto contra un fondo que un instante después ya no
existe, inventando violaciones de contraste sobre colores que nadie ve. En la
revisión que introdujo esta suite eso produjo **71 falsos positivos en una sola
página** antes de añadir la espera. El helper `esperarPintado()` es obligatorio.

Antes de dar por bueno un fallo de contraste, confirma con `getComputedStyle` que el
color medido es el que renderiza de verdad.

### Autorización — tres barridos que se complementan

Ninguno sustituye a los otros; juntos cubren la superficie completa de `/api`:

1. **Escrituras** (`authorization.test.ts`) — toda ruta `POST`/`PATCH`/`PUT`/`DELETE`
   debe estar clasificada como admin, autoservicio o allowlist explícito. Una ruta
   mutante nueva sin clasificar rompe el test.
2. **Lecturas sensibles** (`authorization.test.ts`) — las de cámaras y las de
   actividad por aparato (consultas DNS y tráfico) se clasifican una a una y se
   comprueban rol por rol.
3. **Todas las lecturas** (`route-auth-sweep.test.ts`) — ninguna ruta `GET` de `/api`
   puede responder 2xx sin token, salvo tres públicas por diseño. Tapa el hueco de
   los dos anteriores: una lectura nueva registrada sin `preHandler` quedaba
   **abierta a internet** con toda la suite en verde.

El barrido de lecturas se hace **en negro** (petición real sin token) y no
inspeccionando `preHandler`, porque los módulos protegen de dos formas —por ruta y
con un hook de plugin— y el hook encapsulado no aparece en las opciones de la ruta.
Una comprobación blanca pasaría por alto justo esos módulos.

Los tres llevan **guard de tamaño mínimo**:

```ts
expect(rutas.length).toBeGreaterThan(60);
```

Sin él, si la recolección de rutas se rompiera en una actualización de Fastify, la
lista saldría vacía y el barrido pasaría **sin haber comprobado nada**: «no encontré
rutas» no puede leerse como «está todo bien».

---

## Cómo se verifica que un gate sirve

Un gate que nunca se pone rojo es decorativo, y no hay forma de distinguirlo de uno
que funciona salvo probándolo. Al añadir uno:

1. Introduce la regresión que debe cazar (una ruta sin `preHandler`, un umbral por
   debajo, un chunk gordo).
2. Comprueba que el gate falla **y que el mensaje dice qué arreglar** sin tener que
   volver a ejecutar nada.
3. Retira la regresión con una edición normal, **nunca con `git checkout <fichero>`**,
   que se lleva por delante el trabajo sin commitear de ese fichero, y en silencio.
4. Comprueba que vuelve a verde.

Ojo con los gates que leen de git (`git ls-files`): **no ven un fichero nuevo hasta
que está en el índice**. Haz `git add` antes de darlos por buenos, o te dirán que
todo está bien sobre un fichero que ni han mirado.

---

## Límites conocidos

Lo que estas suites **no** cubren, dicho en voz alta para que nadie lo dé por hecho:

- **Hardware real.** Todo corre con los gestores en mock. Los transportes SSH, SNMP y
  HTTP contra routers de verdad solo se verifican en un despliegue real.
- **Un solo motor en CI.** La suite E2E bloqueante corre en Chromium; Firefox existe
  como proyecto opt-in (`pnpm qa:compat`) pero no entra en cada push. WebKit no está
  configurado. Los riesgos vivos son CSS moderno y las APIs de PWA.
- **Carga sostenida.** `qa:perf` mide ráfagas de segundos, no fugas de memoria ni
  degradación a lo largo de días.
- **Mutación fuera de los seis módulos elegidos.** El resto del agente y toda la web
  no se han medido con mutación: su cobertura dice que se ejecutan, no que se
  vigilen.
- **Barrido dinámico de entradas maliciosas.** No hay fuzzing automático contra el
  servidor en marcha; la validación por esquema de Fastify y el análisis estático
  cubren parte, pero no es lo mismo.
