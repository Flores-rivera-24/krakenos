# ADR: KrakenOS como aplicación de escritorio

**Estado:** aceptado (2026-10-11) · **Ámbito:** distribución y experiencia de uso, no funciones nuevas.

## Contexto

La petición: que KrakenOS **arranque solo con el ordenador y corra siempre en segundo plano**, que se
**abra con un icono** como cualquier aplicación (Word, Discord) y que **cerrar la ventana no pare el
monitoreo**. Sin terminal en el uso diario.

La petición junta dos piezas que en KrakenOS ya están separadas, y separarlas es la mitad de la
solución:

1. **El servicio** (el agente): es quien vigila. Barre el inventario, aplica horarios, arma la
   alarma, detecta movimiento, ejecuta rutinas y avisa. Ya puede correr como servicio de sistema
   (`systemd` con `Restart=on-failure`, o Docker con `restart: unless-stopped`).
2. **La ventana** (la interfaz web): solo **muestra**. Cerrarla nunca ha parado el monitoreo, porque
   el monitoreo no vive en ella.

### Lo que ya existe y sirve

- La interfaz **ya es una PWA instalable**: `manifest.json` con `display: standalone`, iconos
  (192/512/maskable) y atajos; service worker con manejo de navegación y página propia si el agente
  no responde; y el registro trata `http://localhost` como contexto seguro (usa `isSecureContext`).
  Instalada desde Edge o Chrome, aparece en el menú Inicio y la barra de tareas, con ventana propia, y
  Edge puede **abrirla al iniciar sesión**.
- El agente sirve la interfaz y la API **en un solo puerto** (3001), así que la app instalada habla con
  su mismo origen: la cookie de sesión (`SameSite=Strict`), la CSP `connect-src 'self'` y CORS
  funcionan sin tocar nada.
- La sesión dura **30 días** con «mantener sesión iniciada» (activado por defecto): reabrir la app entra
  directo.
- Los avisos que no dependen de ninguna ventana ya existen en el servidor: **correo y Telegram**. Web
  Push también, pero ese sí depende de que el navegador siga en segundo plano.

### Lo que el sistema operativo impone

El agente está hecho para **Linux**. En Windows (la máquina del dueño) caben tres vías para el servicio:

| Vía | Arranca sola | Qué se pierde |
|---|---|---|
| **Windows nativo** (Node como servicio) | Con un envoltorio de servicios | El helper privilegiado (WireGuard, `iptables`, `tc`) no existe; scripts en bash; reescritura. **Descartada.** |
| **Docker Desktop** | Solo si Docker Desktop arranca al iniciar sesión (viene desactivado) | Sin acceso real a la LAN (red NAT; el *host networking* de Docker Desktop es solo de capa 4): el descubrimiento mDNS/SSDP, Govee (broadcast UDP) y el puente Matter no ven los aparatos. **No recomendada en Windows.** En un Linux sí es una vía válida. |
| **WSL2 con `systemd` y red `mirrored`** | Con una tarea programada al iniciar sesión que mantenga viva la distribución | Lo mínimo: el instalador actual (Debian/Ubuntu) funciona dentro, y en modo `mirrored` el agente comparte la red de Windows. El multicast en ese modo está documentado como soportado pero tiene fallos reportados: **hay que verificarlo en la máquina real** antes de prometerlo. |

## La tensión que hay que decir en voz alta

**«Monitoreo en tiempo real en todo momento» y «servicio en mi ordenador personal» se contradicen
cuando el ordenador se suspende o se apaga.** Con el agente parado:

- Los **horarios de control parental** no empiezan ni terminan (el bloqueo vive en el router, pero
  quien lo pone y lo quita a la hora es el agente). La reafirmación tras un reinicio del router tampoco
  ocurre.
- La **alarma**, la **detección de movimiento**, la **presencia**, las **rutinas** y los **avisos**
  dejan de funcionar.
- Los **históricos** (tráfico, energía, DNS) tienen huecos.
- En WSL2, además, el servicio solo existe **después de iniciar sesión** en Windows.

No es un defecto a corregir: es física del despliegue. Por eso esta decisión define **dos perfiles** y
no uno.

## Decisión

### Perfil A — recomendado: servicio en un equipo siempre encendido + app en cada dispositivo

El agente corre en un equipo que no se apaga (Raspberry Pi, mini PC, NAS) con el instalador
(`systemd`) o con Docker en Linux. En el ordenador, el móvil o la tablet se **instala la PWA**. El
monitoreo es continuo de verdad y **no se pierde ninguna función**.

Condición: fuera de `localhost`, la PWA, el service worker, Web Push y las passkeys **exigen HTTPS**.
Este perfil obliga a resolver el HTTPS de la instalación (`install.sh --tls tailscale|self`), que hoy no
es el valor por defecto.

### Perfil B — lo pedido literalmente: todo en el ordenador Windows

El agente corre en **WSL2** (Ubuntu con `systemd` y red `mirrored`), mantenido vivo por una **tarea
programada al iniciar sesión**, y se abre con la **PWA instalada desde `http://localhost:3001`**, con
«abrir al iniciar sesión» activado en Edge. No necesita certificado: `localhost` es contexto seguro.

Es la vía con menos código y la que cumple la petición tal cual, **aceptando** las pérdidas de la tabla
siguiente.

### La ventana: PWA primero, bandeja del sistema solo si se echa de menos

- **Fase 1 — PWA.** Coste casi cero: falta un botón de «Instalar app» (`beforeinstallprompt`), el
  campo `id` del manifiesto y comprobar la instalación en un navegador real.
- **Fase 2 (opcional) — envoltorio Tauri mínimo**, solo si se necesita lo que una PWA no da: **icono en
  la bandeja** con el estado del agente, «Salir» explícito y notificaciones nativas aunque el navegador
  esté cerrado. Cargaría `http://localhost:3001` como origen remoto, **sin IPC y sin empaquetar el
  agente** (el servicio sigue siendo el de WSL2 o el del servidor). Implica firma de código (sin ella,
  SmartScreen avisa) y un actualizador.
- **Electron, descartado:** el mismo resultado que la PWA con más de 100 MB de Chromium que mantener.
- **Cargar la interfaz desde un origen propio de la app (`tauri://`, `file://`), descartado:** rompe la
  cookie de sesión (`SameSite=Strict`) y obliga a tocar CORS, Socket.io y WebAuthn.

## Qué se sacrifica en el Perfil B (y nada en el A)

Ninguna función se **elimina del producto**. En el Perfil B se **degradan** según el equipo, y la
interfaz debe **declararlo** en vez de enseñar una tarjeta que no puede funcionar.

| Función | En el Perfil B | Por qué |
|---|---|---|
| Monitoreo, alarma, movimiento, presencia, rutinas, avisos | Solo con el ordenador encendido y la sesión iniciada | Lo hace el agente; parado no hay nadie vigilando. |
| Horarios de control parental | Pueden no empezar o no terminar a su hora | El agente pone y quita los bloqueos en el router a la hora. |
| Servidor WireGuard, cortafuegos `iptables`, QoS `tc` | No aplicables | Actuarían sobre la máquina virtual de WSL, no sobre la red de casa. Un portátil no es la puerta de enlace. |
| Descubrimiento mDNS/SSDP, Govee, puente Matter | Dependen del modo `mirrored` | Multicast y broadcast no cruzan la red NAT de WSL; en `mirrored` está por verificar. |
| Actualización con un clic | Por verificar | La detección de modo de despliegue no reconoce WSL. |
| Código QR de configuración inicial | Puede apuntar a una IP interna | Toma la primera IPv4 no interna; en red NAT sería la de WSL. |
| Avisos con la app cerrada | Web Push depende de que el navegador siga en segundo plano | Para lo crítico, configurar Telegram o correo, que no dependen de ninguna ventana. |

## Consecuencias

**Trabajo que abre** (en orden):

1. PWA instalable de verdad: botón «Instalar app», `id` y `display_override` en el manifiesto, y una
   prueba en navegador real de que cumple los criterios de instalación.
2. Detección del entorno de ejecución (WSL además de Docker y `systemd`), para que la actualización y
   el código QR digan la verdad, y **declaración de capacidades por plataforma** en la interfaz
   (VPN, cortafuegos y QoS se muestran como no disponibles en vez de fallar).
3. Instalador para Windows: un script de PowerShell que active `systemd` y la red `mirrored` en WSL2,
   ejecute el instalador actual dentro, cree la tarea de inicio de sesión y deje el acceso a la app.
4. Guía publicada de «KrakenOS como app de escritorio» con los dos perfiles.
5. Verificación en la máquina real: arranque tras reinicio, multicast en modo `mirrored`, Web Push con
   la app cerrada, y consumo del agente siempre activo.
6. Opcional, según la experiencia de la fase 1: envoltorio Tauri con bandeja.

**Decisión que se vuelve necesaria:** el HTTPS por defecto en la instalación. Sin él, el Perfil A solo
da la experiencia de app en el propio servidor.

**Lo que no cambia:** el agente sigue siendo un servicio de Linux, el producto se sigue pudiendo usar
desde cualquier navegador, y Docker y `systemd` en Linux siguen siendo vías de primera.
