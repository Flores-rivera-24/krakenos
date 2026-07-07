# Suite e2e de navegador (Playwright) — US-189

Pruebas end-to-end de los **flujos críticos** de KrakenOS contra la app **construida**
(agente sirviendo el frontend) con **managers mock** (sin hardware). Complementan a los
tests unitarios/integración: aquí "los tests pasan" implica "la app funciona en un
navegador real".

## Qué se prueba

| # | Flujo | Cubre |
|---|-------|-------|
| 1 | **Setup** con el token out-of-band → crea el primer admin | onboarding US-81/105, auth, DB |
| 2 | **Login** por formulario → dashboard | auth, sesión |
| 3 | **Crear una habitación** (US-165) | escritura del hogar, slideover |
| 4 | **Escanear inventario + bloquear** un dispositivo | driver mock, escritura, auditoría |

Un **bug real** encontrado por esta suite: los `POST`/`DELETE` **sin cuerpo** enviaban
`Content-Type: application/json`, y Fastify rechaza el JSON vacío con **400** — rompía
bloquear/desbloquear, rescan, logout y la **restauración de sesión al recargar** (US-91).
Corregido en `apps/web/src/lib/api.ts` y `store/auth.store.ts` (no declarar JSON sin cuerpo).

## Cómo funciona

- `e2e/lib/server.ts` arranca el agente **construido** (`dist/index.js`) en el puerto fijo
  **3999**, todo mock, con una **DB SQLite efímera** propia (`prisma/e2e.db`, recreada en
  cada run), sin HTTPS ni `TRUST_PROXY` (cookie de refresh **no** `Secure`, funciona sobre
  http). Captura de su salida el **token de configuración** que imprime al no haber usuarios.
- `global-setup.ts`/`global-teardown.ts` levantan y detienen ese servidor una vez por suite.
- El proyecto **`setup`** (`auth.setup.ts`) ejecuta el flujo de configuración (crea el admin)
  y es **dependencia** del proyecto `chromium`; los demás flujos hacen **login por UI**
  (`lib/auth.ts`). No se reutiliza `storageState` porque Chromium no envía cookies
  `SameSite=Strict` inyectadas en el primer fetch de bootstrap.
- La navegación entre páginas usa **clicks en la nav** (React Router, client-side): un
  `page.goto` recargaría y perdería el access token en memoria (US-91).

## Ejecutar

```bash
pnpm build                 # el agente sirve apps/web/dist
pnpm test:e2e:install      # instala Chromium (una vez; en CI, --with-deps)
pnpm test:e2e              # corre la suite
```

Requiere las claves JWT (`apps/agent/scripts/gen-keys.sh`) y `prisma generate` hechos (como
el resto de la suite). En CI hay un **job aparte** (`e2e`) que no alarga `build-test`; sube
`playwright-report/` y `test-results/` como **artefactos** solo al fallar (trazas + vídeo +
screenshots, por `trace: 'retain-on-failure'`).

## Política de flaky / cuarentena

- **`retries: 1`** en CI (un reintento); local sin reintentos.
- `workers: 1` + `mode: serial`: los flujos comparten una sola DB, así que el orden importa.
- **Cuarentena explícita** con `test.fixme` (no se ejecutan, quedan listados) y su motivo:
  - **2FA con passkey** (virtual authenticator vía CDP WebAuthn): requiere cablear la
    ceremonia registro+login con un autenticador virtual; se activará con el endurecimiento
    de WebAuthn en e2e.
  - **Escenas** (US-166): la UI aún no existe; el flujo se añade cuando se implemente.

Si un test se vuelve flaky, se marca `test.fixme` con un comentario del motivo y un issue de
seguimiento, en vez de dejarlo parpadeando en rojo.
