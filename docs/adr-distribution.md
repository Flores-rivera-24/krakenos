# ADR — Modelo de distribución y canal de updates

- **Estado:** Aceptado (2026-07-16)
- **Contexto de la decisión:** con el instalador de un comando entregado y el
  lanzamiento a primeros usuarios en curso, hay que decidir **el vehículo de
  distribución** a medio plazo y la **evolución del canal de updates** — antes de acumular tres
  medias-vías (instalador + imagen + caja) sin criterio.
- **Decisión en una línea:** **instalador nativo ahora** (ya entregado); el canal de updates
  evoluciona de `git + pnpm` a **tarballs de release con checksum** (decidido, no implementado —
  historia futura, condicionada al feedback de los usuarios); imagen de SO y caja de hardware quedan **explícitamente
  aplazadas** hasta tener señal real de usuarios; Docker permanece como **demo**.

## Las opciones, con sus costes reales

| Vehículo | Qué es | Coste de construir | Coste de mantener | Estado |
|---|---|---|---|---|
| **Instalador nativo** | `curl \| sudo bash` sobre Debian/Ubuntu/Pi: Node pinneado, systemd, idempotente | **Pagado** (~1 script + smoke CI) | Bajo: matriz Debian/Ubuntu/Pi OS × x86-64/ARM64 | ✅ **elegido, entregado** |
| **Imagen de SO** (estilo HAOS) | SO completo con KrakenOS dentro y updates A/B (dos particiones, rollback atómico) | Alto: pipeline de imágenes (buildroot/mender…), firma, por-placa | Alto: kernel/seguridad del SO pasan a ser nuestro problema | ⏸ aplazada — es el estándar de oro de robustez (así funciona HAOS), pero solo se justifica con una base de usuarios que sature el instalador |
| **Caja de hardware** | Aparato con KrakenOS preinstalado (el camino validado del nicho: HA Green $99, Firewalla) | Muy alto: hardware, certificaciones, inventario, logística, soporte | Muy alto | ⏸ aplazada — es el **modelo de negocio validado** del sector, no una opción técnica; se reevalúa solo con demanda demostrada |
| **Docker** | Imagen todo-en-uno no privilegiada | Pagado | Bajo | ✅ se queda como **demo/evaluación**: no opera VPN/firewall/QoS/cámaras/descubrimiento (`docker-limitations.md`) |

## Canal de updates: de `git + pnpm` a tarballs con checksum

**Hoy**: el orquestador hace `git fetch/checkout` + `pnpm install` + build en el
servidor, con backup y rollback. Funciona, pero es frágil por diseño:

- una red que se cae **a media instalación de dependencias** deja `node_modules` inconsistente
  (el rollback lo cubre, pero el update falla entero);
- exige **git + toolchain de build** en la máquina del usuario para siempre;
- el build en una Pi tarda minutos y compite con el propio agente por CPU/RAM;
- no hay **verificación de integridad** del árbol más allá de TLS de GitHub.

**Decisión:** el canal evoluciona a **tarballs de release** — CI construye una vez
(`krakenos-<version>-<arch>.tar.gz` con `dist/` + `node_modules` de producción + prisma),
publica el artefacto con su **checksum sha256** en la release de GitHub, y el orquestador
La actualización one-click pasa de `fetch+build` a `descargar → verificar checksum → desempaquetar en un
directorio nuevo → switch de symlink → migrate → restart → healthcheck`, conservando el
backup/rollback actuales (el rollback se vuelve **más** barato: apuntar el symlink al
directorio anterior). El instalador ya está preparado: `--update` delega en el
orquestador, así que heredará el canal nuevo sin cambios de interfaz.

**Se decide, NO se implementa** (alcance explícito de esta HU): la implementación es una HU
futura que se abrirá cuando el feedback confirme que hay usuarios actualizando de verdad. Hasta
entonces `git + pnpm` sigue siendo el canal, con su rollback probado.

## Modelo de sostenibilidad: qué se evalúa con los usuarios reales

El mercado del nicho **no valida licencias de software** — valida **hardware** (HA Green,
Firewalla) y **relay/conveniencia** (Nabu Casa: ~$6.5/mes por acceso remoto sin fricción +
financiar el desarrollo). Con el canal de feedback se evalúan, por observación y no por encuesta:

1. **¿La gente instala y actualiza?** (métrica: instalaciones reales del checklist de
   lanzamiento; updates aplicados). Si nadie actualiza, la caja/imagen ganan peso.
2. **¿El acceso remoto es el dolor?** (cuántos usuarios llegan al muro CGNAT y usan
   Tailscale). Si es mayoría, un **relay propio** estilo Nabu Casa es el candidato de
   sostenibilidad natural — con su propio ADR (rompería «cero infraestructura nuestra»).
3. **¿Piden un aparato?** Si el feedback recurrente es «véndemelo montado», la caja pasa de
   aplazada a evaluable con números reales.

Ninguna de las tres se decide hoy: este ADR fija **qué señal** dispara cada reevaluación.

## Consecuencias

- **A favor:** una sola vía de instalación que mantener (instalador + systemd); el canal de
  updates tiene rumbo claro sin pagar la implementación antes de tener usuarios; Docker deja
  de generar expectativas falsas; los criterios de reevaluación quedan escritos antes del
  lanzamiento (no se decidirá con el hype del momento).
- **En contra:** los usuarios de distros no-Debian siguen en instalación manual; el update
  `git+pnpm` seguirá siendo frágil hasta la HU de tarballs; renunciar hoy a imagen/caja
  significa que la robustez A/B de HAOS queda fuera del alcance a corto plazo.

## Reevaluar si…

- El feedback muestra **>25% de updates fallidos/revertidos** con el canal git+pnpm → adelantar la
  HU de tarballs.
- Aparece **demanda real de caja** (usuarios pidiendo hardware montado) o un volumen que
  justifique imagen de SO → abrir el ADR de hardware/imagen con números.
- El muro CGNAT resulta mayoritario → ADR de relay propio (sostenibilidad estilo Nabu Casa).

> Relacionados: `adr-positioning.md` (enfoque de producto) · `docs/updates.md` (canal actual
> `docs/updates.md` · `docs/docker-limitations.md` (por qué Docker es demo) · el instalador.
