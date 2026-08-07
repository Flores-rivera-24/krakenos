# Verificación de montaje: `pnpm dev` y `pnpm prod` bajo Playwright

Suite de navegador que corre **los mismos flujos contra los dos montajes reales**
del proyecto. Vive en `e2e/stacks/` y es independiente de la suite de flujos
principal (`e2e/`, ver `docs/e2e.md`), que sigue siendo el gate rápido de CI.

## Por qué existe

La suite principal corre contra un montaje **propio**: `dist/index.js` con
`NODE_ENV=test`, `SERVE_WEB=true` y un puerto fijo. Es determinista, y por eso
mismo no ejerce ninguno de los dos montajes que usa una persona de verdad:

| | `pnpm dev` | `pnpm prod` | arnés de la suite principal |
|---|---|---|---|
| Quién sirve la UI | Vite (:5173) | el agente | el agente |
| API | proxy de Vite → :3001 | mismo puerto | mismo puerto |
| WebSocket | proxy `ws` de Vite | directo | directo |
| Código | módulos sueltos, HMR | chunks con hash | chunks con hash |
| `NODE_ENV` | `development` | `production` | `test` |
| CSP | ninguna (la pone el agente) | activa | activa |

Cada diferencia de esa tabla es un sitio donde algo puede fallar **solo en uno de
los dos** y ninguna suite lo vería. Todos los fallos que encontró esta suite en su
primera tanda estaban en esa columna: la fuente bloqueada por la CSP solo en
producción, el service worker sirviendo código viejo solo en desarrollo, y una
excepción del dashboard que solo aparecía sobre el build minificado.

## Cómo se corre

```bash
pnpm test:e2e:stacks               # construye, levanta ambos stacks y corre todo
STACKS_SKIP_BUILD=1 pnpm test:e2e:stacks          # sin reconstruir (iterar)
pnpm test:e2e:stacks --project=dev                # solo un montaje
pnpm test:e2e:stacks -g "se puede abrir en frío"  # un grupo
```

Puertos: **:3001** (agente dev) · **:5173** (Vite) · **:3002** (prod). Cada stack
tiene su **propia base de datos** efímera (`prisma/stack-{dev,prod}.db`) y crea su
propio admin recorriendo el wizard de verdad. Todos los managers van en `mock`.

> ⚠️ Es más lenta que la suite de CI (arranca Vite y hace un build): ~2 min. No
> sustituye a `pnpm test:e2e`; se corre **antes de publicar** y al tocar algo que
> viva en la tabla de arriba (CSP, service worker, proxy, cookies de sesión).

### Si Chromium no arranca

Mismo problema y misma solución que la suite principal — ver
`docs/e2e.md → «Si Chromium no arranca»` (paquetes `libnspr4`, `libnss3` y
`libasound2t64` desempaquetados en `$HOME` sin root, y `LD_LIBRARY_PATH`).

## Qué cubre

| Fichero | Qué fija |
|---|---|
| `setup/admin.setup.ts` | el wizard de configuración completo, **sin errores de consola**, en cada stack |
| `specs/navegacion.spec.ts` | las **19 páginas** del admin, navegando por el menú **y** entrando en frío por URL (marcador / F5) |
| `specs/sesion.spec.ts` | la sesión sobrevive a una recarga · atributos de la cookie de refresh · logout · error de credenciales |
| `specs/tiempo-real.spec.ts` | Socket.io se conecta **y recibe**, también a través del proxy `ws` de Vite |
| `specs/service-worker.spec.ts` | el SW existe en producción y **no** en desarrollo; no cachea nada de URL estable |
| `specs/dashboard.spec.ts` | el dashboard se asienta sin excepciones (12 widgets a la vez) |

### La regla que hace útil a esta suite

Cada test engancha `observarProblemas(page)` **antes** del primer `goto` y al
final asevera tres listas vacías: errores de consola, peticiones caídas y
respuestas 4xx/5xx. Eso es lo que convierte «la página se ve bien» en «la página
no está rota por dentro» — la excepción del dashboard (`t is not iterable`) no se
notaba mirando la pantalla.

El ruido conocido se filtra en `lib/harness.ts::RUIDO_CONSOLA`, con el motivo
escrito. **Cada entrada nueva en esa lista es una regresión que la suite deja de
ver**: se añaden con cuentagotas y nunca para «poner el test en verde».

## Trampas encontradas al montarla

- **Los enlaces del menú con contador no se localizan por texto**: el de Firewall
  se llama «Firewall 2». Se buscan por `href` (`lib/harness.ts::enlaceDeNav`).
- **No se puede aseverar sobre `<h1>`**: solo 3 de las 19 páginas tienen uno, la
  mayoría titula con `<h2>` y `/inventory`, `/people` y `/dns` no tienen **ningún**
  encabezado. `esperarContenido()` mira que `<main>` tenga contenido.
- **Cada stack necesita subir su `loginRateLimit`**: cada flujo hace su propio
  login por UI y, con dos docenas de flujos, la tanda se come el límite por IP.
- **`vite` y el agente se lanzan `detached`** y se matan por grupo: si no, dejan
  hijos vivos ocupando el puerto para la siguiente tanda.
