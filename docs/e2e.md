# Suite e2e de navegador (Playwright) — US-189

Pruebas end-to-end de los **flujos críticos** de KrakenOS contra la app **construida**
(agente sirviendo el frontend) con **managers mock** (sin hardware). Complementan a los
tests unitarios/integración: aquí "los tests pasan" implica "la app funciona en un
navegador real".

## Qué se prueba

**12 flujos activos** (eran 4 hasta US-261).

| # | Flujo | Cubre |
|---|-------|-------|
| 1 | **Setup** con el token out-of-band → crea el primer admin | onboarding US-81/105, auth, DB |
| 2 | **Login** por formulario → dashboard | auth, sesión |
| 3 | **Crear una habitación** (US-165) | escritura del hogar, slideover |
| 4 | **Escanear inventario + bloquear** un dispositivo | driver mock, escritura, auditoría |
| 5 | **Crear una escena** desde plantilla y **ejecutarla** (US-166) | escenas, IoT mock, ejecución |
| 6-8 | **Alarma**: armar → desarmar con PIN · PIN incorrecto no desarma · un `kid` no puede armar (US-261) | US-188, capacidad `home.control`, PIN bcrypt |
| 9-10 | **Rol `member`**: enciende un IoT · no ve «Red avanzada» (US-261) | US-179, `home.control` vs `requireRole('admin')` |
| 11-12 | **Inglés** (proyecto `chromium-en`): sin sesión manda el navegador · con sesión manda `User.locale` (US-261) | US-177, catálogo `en.ts` |

Los flujos de US-261 se eligieron por dónde duele: la alarma es lo único que puede
sonar de madrugada y la 3ª auditoría encontró dos fallos justo ahí; el `member` es el
usuario mayoritario y su capacidad `home.control` se rompe con un refactor que la
suite de autorización (que prueba *viewer*) no detecta; y el inglés **no tenía ni un
flujo**, así que el catálogo `en.ts` podía quedarse a medias sin que nada avisara.

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
- El contexto del navegador va **fijado a `locale: 'es-ES'`** (`playwright.config.ts`): la suite
  asevera la UI en español (fuente canónica del copy), y sin fijarlo Chromium arranca en `en-US` y
  la detección de idioma (US-177) renderiza la app en inglés → todos los selectores fallan. Si un
  día se quiere un flujo e2e en inglés, será un proyecto aparte con su propio `locale`.

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

### Si Chromium no arranca (WSL / máquina sin las libs)

El Chromium de Playwright necesita `libnspr4`, `libnss3` y `libasound2`, que no vienen en una
Ubuntu mínima ni en muchos WSL. La vía normal es:

```bash
sudo pnpm exec playwright install-deps chromium
```

**Sin `sudo`** (p. ej. una cuenta sin permisos), se pueden extraer los `.deb` a un prefijo
propio — `apt-get download` no necesita root:

```bash
DEPS="$HOME/.cache/krakenos/playwright-deps"
mkdir -p "$DEPS/debs" && cd "$DEPS/debs"
for p in libnspr4 libnss3 libasound2t64; do apt-get download "$p"; done
for d in *.deb; do dpkg-deb -x "$d" "$DEPS/root"; done
ln -sf libasound.so.2.0.0 "$DEPS/root/usr/lib/x86_64-linux-gnu/libasound.so.2"

# y en cada sesión donde se corra la suite:
export LD_LIBRARY_PATH="$HOME/.cache/krakenos/playwright-deps/root/usr/lib/x86_64-linux-gnu"
```

En Ubuntu 24.04 el paquete es `libasound2t64` (renombrado desde `libasound2`). Para comprobar
que no falta nada: `ldd ~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome | grep "not found"`.
En **CI no hace falta**: el job usa `--with-deps`.

## Política de flaky / cuarentena

- **`retries: 1`** en CI (un reintento); local sin reintentos.
- `workers: 1` + `mode: serial`: los flujos comparten una sola DB, así que el orden importa.
- ⚠️ **El rate-limit de login lo agota una suite que crece** (US-261). Cada flujo hace su
  propio login por UI —a propósito: `storageState` no funciona con la cookie
  `SameSite=Strict`— y el límite real son **10/min por IP** (US-47). Al pasar de 5 a 13
  flujos, la tanda empezó a recibir **429** y varios tests caían con «No se pudo conectar
  con el servidor». Dos mitigaciones: `auth.setup.ts` sube `loginRateLimit` a 1000 **solo en
  el arnés** (el límite real se prueba en `rate-limit.test.ts` del agente), y los helpers de
  `lib/api.ts` **cachean el token de admin** en vez de loguearse en cada llamada. Si añades
  flujos y ves fallos de login aleatorios, es esto.
- ⚠️ **Un 429 se ve como «No se pudo conectar con el servidor»** en la pantalla de login:
  `LoginPage` solo distingue el 401 (credenciales) del resto (US-55). Cuesta diagnosticar
  porque parece un problema de red. Anotado como deuda de copy en US-235.
- **Cuarentena explícita** con `test.fixme` (no se ejecutan, quedan listados) y su motivo:
  - **2FA con passkey** (virtual authenticator vía CDP WebAuthn): requiere cablear la
    ceremonia registro+login con un autenticador virtual; se activará con el endurecimiento
    de WebAuthn en e2e.
  - (El flujo de **escenas** de US-166 ya está **activo**; salió de cuarentena al llegar su UI.)

Si un test se vuelve flaky, se marca `test.fixme` con un comentario del motivo y un issue de
seguimiento, en vez de dejarlo parpadeando en rojo.
