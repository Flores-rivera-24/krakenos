# Suite e2e de navegador (Playwright)

Pruebas end-to-end de los **flujos críticos** de KrakenOS contra la app **construida**
(agente sirviendo el frontend) con **managers mock** (sin hardware). Complementan a los
tests unitarios/integración: aquí "los tests pasan" implica "la app funciona en un
navegador real".

## Qué se prueba

Los tests viven en `e2e/tests` (y los de inglés en `e2e/tests-en`), más 1 de preparación (`auth.setup.ts`). El recuento actual se obtiene con `pnpm exec playwright test -c e2e/playwright.config.ts --list` desde la raíz, que incluye los generados en bucle (la suite de accesibilidad recorre 7 páginas dos veces). La tabla de abajo agrupa por flujo, no por test.

| # | Flujo | Cubre |
|---|-------|-------|
| 1 | **Setup** con el token out-of-band → crea el primer admin | onboarding, auth, DB |
| 2 | **Login** por formulario → dashboard | auth, sesión |
| 3 | **Crear una habitación** | escritura del hogar, slideover |
| 4 | **Escanear inventario + bloquear** un dispositivo | driver mock, escritura, auditoría |
| 5 | **Crear una escena** desde plantilla y **ejecutarla** | escenas, IoT mock, ejecución |
| 6-8 | **Alarma**: armar → desarmar con PIN · PIN incorrecto no desarma · un `kid` no puede armar | capacidad `home.control`, PIN bcrypt |
| 9-10 | **Rol `member`**: enciende un IoT · no ve «Red avanzada» | `home.control` vs `requireRole('admin')` |
| 11-12 | **Inglés** (proyecto `chromium-en`): sin sesión manda el navegador · con sesión manda `User.locale` | i18n, catálogo `en.ts` |
| 13-15 | **PWA**: el manifiesto y sus iconos se sirven · el service worker queda activo en `localhost` · Ajustes enseña la tarjeta de instalación en un estado coherente | manifiesto, `sw.js`, instalación |
| 16-30 | **Accesibilidad** (`a11y.spec.ts`): axe WCAG A/AA y un solo `<h1>` en 7 páginas, más el contraste real en el tema del usuario | WCAG, estructura de encabezados |

Los flujos se eligieron por dónde duele: la alarma es lo único que puede
sonar de madrugada y la 3ª auditoría encontró dos fallos justo ahí; el `member` es el
usuario mayoritario y su capacidad `home.control` se rompe con un refactor que la
suite de autorización (que prueba *viewer*) no detecta; y el inglés **no tenía ni un
flujo**, así que el catálogo `en.ts` podía quedarse a medias sin que nada avisara.

Un **bug real** encontrado por esta suite: los `POST`/`DELETE` **sin cuerpo** enviaban
`Content-Type: application/json`, y Fastify rechaza el JSON vacío con **400** — rompía
bloquear/desbloquear, rescan, logout y la **restauración de sesión al recargar**.
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
  `page.goto` recargaría y perdería el access token en memoria.
- El contexto del navegador va **fijado a `locale: 'es-ES'`** (`playwright.config.ts`): la suite
  asevera la UI en español (fuente canónica del copy), y sin fijarlo Chromium arranca en `en-US` y
  la detección de idioma renderiza la app en inglés → todos los selectores fallan. Si un
  día se quiere un flujo e2e en inglés, será un proyecto aparte con su propio `locale`.

## Correr la suite en local

```bash
pnpm test:e2e:local                                          # build + toda la suite
pnpm test:e2e:local e2e/tests/navegacion.spec.ts --project=chromium
pnpm test:e2e:local --no-build -g "alarma" --headed          # sin rebuild, con ventana
pnpm test:e2e:report                                         # abre el último informe HTML
pnpm test:e2e:ui                                             # modo interactivo (--ui) de Playwright
```

`test:e2e:ui` abre la ventana de Playwright (en WSL con WSLg sale sola): ves los tests en vivo con su
línea de tiempo y, con el modo watch (el icono del ojo junto a un test), se re-ejecutan al guardar un
cambio. Hace las mismas comprobaciones que `test:e2e:local` (puerto, librerías, navegador, build;
`--no-build` lo salta) y pasa el resto de argumentos a Playwright, p. ej. un spec concreto. Sin
ventana: `pnpm test:e2e:ui --en-navegador` sirve la UI en `http://127.0.0.1:9324` para abrirla desde
cualquier navegador (también el de Windows). `test:e2e:report` sirve el informe en
`http://localhost:9323` (si no se abre solo, pega la URL) y, si aún no hay informe, lo dice.

Es el camino recomendado en una máquina de desarrollo (WSL incluido): `scripts/e2e-local.mjs`
comprueba, **antes** de lanzar nada, lo que si falla no se parece a su causa, y **no mata ni
instala nada** por su cuenta:

1. **Puerto 3999** (fijo, `E2E_PORT` en `e2e/lib/server.ts`): si está ocupado, dice qué PID y qué
   comando lo tienen y da el `kill -TERM <pid>` (nunca `-9`) para que decidas tú.
2. **Librerías de Chromium** (`libnspr4`, `libnss3`, solo en Linux): si faltan y existe el apaño sin
   root (ver más abajo), lo usa por `LD_LIBRARY_PATH` y lo dice; si no existe, se detiene y explica las
   dos salidas.
3. **Navegador**: si falta el Chromium de la versión de Playwright del repo, sugiere
   `pnpm test:e2e:install`.
4. **Build**: ejecuta `pnpm build` antes (la suite corre contra el build; olvidarlo da resultados de
   código viejo). `--no-build` lo salta.
5. **Playwright local** (nunca `npx`: el `.npmrc` de pnpm hace que npm avise de configuración
   desconocida) con reporter `list` + `html`, y propaga su código de salida. El resto de argumentos
   pasan tal cual: specs, `-g`, `--headed`, `--ui`, `--project`.

Al terminar imprime cómo abrir el informe y dónde están las trazas:

```bash
pnpm test:e2e:report                                     # informe HTML (no se abre solo)
pnpm exec playwright show-trace e2e/test-results/<carpeta>/trace.zip
```

El informe HTML solo lo escribe la suite si se pide (la config lo activa por defecto únicamente con
`CI`); `test:e2e:local` lo pide siempre, por eso `test:e2e:report` funciona tras una ejecución local.
Si corres Playwright a mano (`pnpm test:e2e`) con `--reporter=html`, su línea «To open last HTML
report run: …» no lleva la carpeta cuando el informe va a otra ruta: usa `test:e2e:report`.
`test:e2e:local` cierra el stdin de la suite precisamente para que esa línea no salga.

## Ejecutar

Lo de abajo es lo que hace `test:e2e:local` por dentro, por si quieres los pasos sueltos:

```bash
pnpm build                 # el agente sirve apps/web/dist
pnpm test:e2e:install      # instala Chromium (una vez; en CI, --with-deps)
pnpm test:e2e              # corre la suite
```

Requiere las claves JWT (`pnpm --filter @krakenos/agent keys:gen`) y `prisma generate` hechos (como
el resto de la suite). En CI hay un **job aparte** (`e2e`) que no alarga `build-test`; sube
`playwright-report/` y `test-results/` como **artefactos** solo al fallar (trazas + vídeo +
screenshots, por `trace: 'retain-on-failure'`).

### Si Chromium no arranca (WSL / máquina sin las libs)

El Chromium de Playwright necesita `libnspr4`, `libnss3` y `libasound2`, que no vienen en una
Ubuntu mínima ni en muchos WSL. La vía normal es:

```bash
sudo env "PATH=$PATH" "$PWD/node_modules/.bin/playwright" install-deps chromium
```

(`sudo` no hereda el `PATH` de nvm, de ahí el `env` y la ruta del binario local.)

**Sin `sudo`** (p. ej. una cuenta sin permisos), se pueden extraer los `.deb` a un prefijo
propio — `apt-get download` no necesita root:

```bash
DEPS="$HOME/.cache/krakenos/playwright-deps"
mkdir -p "$DEPS/debs" && cd "$DEPS/debs"
for p in libnspr4 libnss3 libasound2t64; do apt-get download "$p"; done
for d in *.deb; do dpkg-deb -x "$d" "$DEPS/root"; done
ln -sf libasound.so.2.0.0 "$DEPS/root/usr/lib/x86_64-linux-gnu/libasound.so.2"

# `pnpm test:e2e:local` lo detecta y lo usa solo. Para correr Playwright a mano:
export LD_LIBRARY_PATH="$HOME/.cache/krakenos/playwright-deps/root/usr/lib/x86_64-linux-gnu"
```

En Ubuntu 24.04 el paquete es `libasound2t64` (renombrado desde `libasound2`). Para comprobar
que no falta nada: `ldd ~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome | grep "not found"`.
En **CI no hace falta**: el job usa `--with-deps`.

## Política de flaky / cuarentena

- **`retries: 1`** en CI (un reintento); local sin reintentos.
- `workers: 1` + `mode: serial`: los flujos comparten una sola DB, así que el orden importa.
- ⚠️ **El rate-limit de login lo agota una suite que crece**. Cada flujo hace su
  propio login por UI —a propósito: `storageState` no funciona con la cookie
  `SameSite=Strict`— y el límite real son **10/min por IP**. Al pasar de 5 a 13
  flujos, la tanda empezó a recibir **429** y varios tests caían con «No se pudo conectar
  con el servidor». Dos mitigaciones: `auth.setup.ts` sube `loginRateLimit` a 1000 **solo en
  el arnés** (el límite real se prueba en `rate-limit.test.ts` del agente), y los helpers de
  `lib/api.ts` **cachean el token de admin** en vez de loguearse en cada llamada. Si añades
  flujos y ves fallos de login aleatorios, es esto.
- ⚠️ **Un 429 se ve como «No se pudo conectar con el servidor»** en la pantalla de login:
  `LoginPage` solo distingue el 401 (credenciales) del resto. Cuesta diagnosticar
  porque parece un problema de red. Anotado como deuda de copy.
- **Cuarentena explícita** con `test.fixme` (no se ejecutan, quedan listados) y su motivo.
  Ahora mismo no hay ninguno.
- **2FA con passkey** (`dos-factores.spec.ts`): autenticador virtual de Chromium por CDP
  (`WebAuthn.addVirtualAuthenticator`, CTAP2 interno con verificación de usuario). Dos cosas
  que no son obvias: el RP ID es un hostname, así que el agente e2e arranca con
  `WEBAUTHN_ORIGIN=http://localhost:3999` y este spec navega por `localhost` (el resto, por
  `127.0.0.1`); y usa **un usuario nuevo por ejecución**, porque la passkey se queda en la DB
  pero el autenticador muere con el contexto (con `--repeat-each` el segundo intento pediría un
  factor que nadie puede dar). Nunca registres una passkey en el admin: todos los demás flujos
  entran con él.

Si un test se vuelve flaky, se marca `test.fixme` con un comentario del motivo y un issue de
seguimiento, en vez de dejarlo parpadeando en rojo.
