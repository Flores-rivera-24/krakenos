# ADR: KrakenOS instalable en Windows y Linux desde un ejecutable

**Estado:** aceptado (2026-10-13) · **Sustituye en parte a:** `adr-app-escritorio.md` (el descarte de
«Windows nativo» y el Perfil B sobre WSL2) · **Ámbito:** distribución, servicio, instalador,
actualizaciones y lo que cada plataforma puede hacer.

## Contexto

El objetivo cambia: KrakenOS tiene que **funcionar en Windows y en Linux**, y un usuario final tiene que
poder **descargar un ejecutable y que de ahí todo empiece a funcionar**: el agente corriendo en segundo
plano aunque nadie haya iniciado sesión, una aplicación que se abre con un icono y HTTPS en la LAN para
que la PWA, las notificaciones y las passkeys funcionen.

Hoy solo existe un camino: `scripts/install.sh` en Debian/Ubuntu/Raspberry Pi OS (git clone + build +
systemd). `adr-app-escritorio.md` descartó Windows nativo porque las operaciones privilegiadas del
agente (`wg`, `iptables`, `tc`) solo existen en Linux, y propuso WSL2 como camino para Windows.

### Lo que se midió antes de decidir

**El agente es mucho más portable de lo que el descarte suponía.** Un inventario del código (2026-10-13)
lo clasifica así:

| Clase | Qué incluye |
|---|---|
| **Portable** (habla con el router y los aparatos por red) | Los 7 drivers de router, los backends IoT, DNS (Pi-hole), VLAN por SNMP, cámaras Frigate y el resto de módulos de la aplicación (personas, rutinas, alarma, energía, cobertura, usuarios…) |
| **Degradado** (funciona a medias) | Descubrimiento por multicast (UDP 5353/1900 compartidos con el sistema), cámaras RTSP (necesitan `ffmpeg`), detección de Tailscale (socket UNIX → *named pipe*), permisos `0600` (NTFS no los aplica), IP del QR de setup |
| **Solo Linux** | Las tres funciones de **puerta de enlace** (servidor WireGuard, cortafuegos con `iptables`, QoS con `tc`, todas por el helper con `sudo`) y el **actualizador actual** (git + pnpm + `systemctl`) |

Para empaquetarlo hay dos dependencias nativas: `bcrypt` (addon con *prebuilds*) y Prisma 5 (motores en
Rust por plataforma, también para `migrate deploy`). Los scripts de claves JWT se pueden hacer con
`node:crypto`; la CA local necesita una librería X.509 en JS, porque `node:crypto` no emite certificados.

## Decisión

### 1. En Windows, KrakenOS es el *cerebro* de la red, no la puerta de enlace

Un PC de casa no es el router. En Windows se ofrece todo lo que habla con el router y los aparatos, y las
funciones de puerta de enlace se **declaran no disponibles en esa plataforma**, con el mismo patrón que
ya usa el desglose de tráfico por router: la capacidad se declara y viaja con los datos, nunca se finge
con datos simulados ni se deja fallar con un error 500 genérico.

- **Acceso remoto en Windows:** Tailscale (ya detectado por el agente) o el WireGuard del propio router.
- **Cortafuegos y QoS en Windows:** los del router, a través de su driver, donde el driver los soporte.

### 2. El servicio y la ventana siguen siendo piezas distintas

Se mantiene el principio del ADR anterior. El **agente** es un servicio del sistema que arranca con el
equipo; la **ventana** es solo una forma de abrir la interfaz y cerrarla no para nada.

### 3. El «ejecutable» es un instalador por plataforma

| | Windows | Linux |
|---|---|---|
| **Lo que descarga el usuario** | `KrakenOS-Setup.exe` (instalador NSIS) | `.deb` (Debian, Ubuntu, Raspberry Pi OS; x64 y arm64) |
| **Agente** | Node 24 oficial + build del agente + dependencias de producción en la carpeta de instalación | Igual |
| **Servicio** | Servicio de Windows con reinicio automático (envoltorio WinSW) | Unidad systemd (la actual) |
| **Datos** | `%ProgramData%\KrakenOS`, con ACL solo para el servicio y Administradores | `/var/lib/krakenos` |
| **Ventana** | Aplicación con icono y bandeja (Tauri 2) que carga el origen del agente | Lanzador que abre el navegador del sistema, y la PWA |
| **HTTPS** | Tailscale si está; si no, CA local que el instalador importa al almacén de confianza | Igual, con `update-ca-certificates` |
| **Cortafuegos del sistema** | El instalador crea la regla de entrada del puerto del agente (perfil privado) | — |

**Por qué no un ejecutable único (Node SEA, `pkg`, Bun):** SEA en Node 24 sigue en desarrollo activo y
solo admite un script CommonJS; `pkg` añade un Node parcheado (más sospechas de antivirus); Bun y Deno
cambiarían el runtime de todo el producto. Node oficial en una carpeta no tiene ningún riesgo de
compatibilidad, y para el usuario la diferencia no existe: descarga un `.exe`, lo ejecuta y la
aplicación aparece. Se revisa cuando SEA sea estable con ESM.

**Por qué Tauri solo en Windows:** en Linux el WebView (WebKitGTK) no soporta WebAuthn, así que una
ventana propia perdería las passkeys. La ventana no tiene IPC con el sistema: carga el origen del agente
como cualquier navegador, para que la cookie de sesión, CORS y WebAuthn sigan funcionando.

### 4. La base de datos deja de necesitar binarios de Prisma en el equipo

Prisma 5 → **Prisma 7** con el adaptador `better-sqlite3` (sin motor de consultas en Rust), y las
migraciones se aplican con un **aplicador propio** de los `migration.sql` existentes, compatible con la
tabla `_prisma_migrations`, en vez de la CLI de Prisma. Es un cambio con riesgo propio: va primero y solo.

### 5. Las actualizaciones pasan a ser por paquete

El actualizador de un clic deja de depender de git y pnpm en el equipo del usuario: descarga el
instalador o paquete nuevo de la publicación firmada, comprueba su firma y su suma, y lo aplica (en
Windows, el instalador silencioso para y arranca el servicio; en Linux, el `.deb`). Se conserva lo que ya
funciona: copia de la base antes de migrar, comprobación de salud y vuelta atrás.

### 6. Lo que no cambia

`install.sh` sigue existiendo como instalación avanzada en Linux. Docker sigue igual.

## Consecuencias

- **El Perfil B (agente en WSL2) se retira:** Windows nativo lo sustituye, sin la máquina virtual, sin la
  red `mirrored` y sin la tarea que la mantenía viva.
- **En Windows hay funciones que no existen**, y la interfaz lo dice en vez de esconderlo.
- **`<equipo>.local` no está garantizado en Windows:** Windows resuelve nombres `.local` pero no anuncia
  el suyo. El agente tendrá que responder por mDNS a su propio nombre, y mientras tanto Tailscale es la
  vía de HTTPS recomendada en Windows.
- **Un equipo que se suspende no vigila** (ya reconocido): el instalador lo advierte.
- **Firma de código:** sin firma, Windows SmartScreen avisa al instalar. Firmar tiene coste o requisitos
  (ver «Decisiones abiertas»).
- **CI crece:** compilar y probar en Windows (x64) y Linux (x64 y arm64), incluida una instalación
  silenciosa del `.exe` en un runner de Windows.

## Decisiones del dueño (2026-10-13)

1. **Firma de código:** se publica **sin firma** al principio. Windows SmartScreen avisará al instalar, y
   la guía de instalación explica cómo continuar. Se revisa cuando haya usuarios fuera del círculo cercano.
2. **Energía:** el instalador de Windows **solo avisa** de que un equipo que se suspende deja de vigilar.
   No cambia el plan de energía.
3. **Paquetes de Linux:** solo `.deb`. Sin `.rpm`.
4. **Funciones de puerta de enlace en Windows:** se acepta que en Windows no hay servidor VPN, cortafuegos
   ni QoS propios. El acceso remoto va por Tailscale o por el WireGuard del router.

## Lo que hay que verificar con una máquina real

Ninguno de estos puntos se puede dar por cierto leyendo documentación: el puerto UDP 5353 compartido con
el cliente mDNS de Windows; el cierre ordenado del agente bajo el servicio de Windows (que manda Ctrl+C,
no `SIGTERM`); WebAuthn dentro de WebView2 con un origen remoto; que el servicio arranque sin sesión
iniciada; y que una librería X.509 en JS emita la extensión `nameConstraints` de la CA.
