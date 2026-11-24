# Actualizaciones (comprobación · one-click con rollback · cadena real)

KrakenOS puede avisarte cuando hay una versión más nueva publicada como _release_ en
GitHub. La comprobación es **opcional**: sin configuración, el agente **no hace
ninguna llamada externa** (coherente con la postura "sin nube de terceros").

## Activarlo

Si instalaste con `scripts/install.sh`, **ya está activo**: el instalador escribe
`UPDATE_CHECK_REPO` en el `.env` que genera, porque sin él no hay releases
que comparar y la actualización one-click no puede funcionar. En un `.env` copiado a
mano de `.env.example` está comentado (desarrollo = cero llamadas externas).

Para activarlo o cambiarlo, define el repositorio de GitHub en el entorno del agente:

```bash
UPDATE_CHECK_REPO=Flores-rivera-24/krakenos
```

Con esa variable, **Ajustes → Sistema → Actualizaciones** muestra:

- **Versión instalada** (leída del `package.json` del agente).
- Si hay una **release más nueva**, un aviso con la última versión disponible.
- Si estás al día, una confirmación.

## Cómo funciona

- El agente consulta `https://api.github.com/repos/<owner>/<repo>/releases/latest`
  y compara el `tag_name` (p. ej. `v1.2.0`) con tu versión por _major/minor/patch_.
- El resultado se **cachea 1 hora** para no golpear la API de GitHub en cada carga
  de la página (el límite sin autenticar es de 60 peticiones/hora por IP).
- Cualquier fallo de red o respuesta inesperada **degrada en silencio** a "sin datos"
  (`latest: null`), nunca rompe la página.
- El endpoint (`GET /api/system/update-check`) es **lectura autenticada**; no expone
  la versión a usuarios no autenticados (ver `PUBLIC_VERSION`).

## Aplicar la actualización one-click

Desde **Ajustes → Sistema → Actualizaciones**, un admin puede aplicar la actualización
sin tocar la terminal. El comportamiento depende del **modo de despliegue** (se detecta
solo: `KRAKENOS_DEPLOY_MODE` (`systemd`, `docker`, `windows-service` o `package`), luego
Windows → `windows-service`, luego `/.dockerenv` → `docker`, si no → `systemd`). `systemd` y `package`
se actualizan desde la UI (cada una a su manera); en Docker se muestra el comando, y
`windows-service` no tiene todavía actualización desde la UI.

### Bare-metal / systemd — actualización automática con rollback

Al pulsar **«Actualizar ahora»**, el agente lanza un **proceso actualizador aparte**
(`dist/update-runner.js`) que corre esta secuencia (orquestador puro
`update-orchestrator.ts`, verificado en tests con un runner inyectable):

1. **backup** — snapshot consistente de la base SQLite a `<db>.pre-update` con
   `VACUUM INTO` (con WAL activo, una copia del fichero a secas se
   dejaría atrás lo que aún no está en el fichero principal) y anota el commit actual.
2. **fetch** — `git fetch --tags` y verifica que existe la etiqueta `v<versión>`.
3. **apply** — `git checkout` de la etiqueta + `pnpm install --frozen-lockfile` +
   `pnpm build` + **reinstalación de las deps opcionales** (abajo).
4. **migrate** — `node apps/agent/dist/migrate.js` (el aplicador propio de migraciones, el recién construido; ya no la CLI de Prisma). Antes de aplicar nada hace una copia `var/pre-migrate-<fecha>.db` (se conservan las 3 últimas) y se niega a seguir, nombrando la migración, si la base y el código no cuentan la misma historia.
5. **restart** — `systemctl restart <servicio>` (por eso corre en un proceso aparte:
   sobrevive al reinicio del agente).
6. **healthcheck** — sondea `/health/ready` unos segundos.

Si **cualquier paso tras el backup falla** (o el healthcheck no pasa), hace
**rollback** automático: **para** el servicio, vuelve al commit anterior, restaura la
DB previa (descartando el `-wal`/`-shm` de la versión nueva) y **arranca**. El orden
importa: sobrescribir el fichero SQLite con el agente vivo lo corrompería.
El proceso es **one-shot** → nunca entra en un bucle de reinicio. El resultado
(correcta / revertida) se guarda en `var/update-result.json` y se muestra en la tarjeta
al volver.

### Requisitos en el servidor

Si instalaste con `scripts/install.sh`, los dos primeros **ya están puestos**. La
ejecución real se verifica en despliegue.

- **`KillMode=process` en la unidad systemd. Imprescindible.** El actualizador es un
  proceso hijo del agente y el paso 5 reinicia esa misma unidad: con el `KillMode` por
  defecto (`control-group`) systemd lo mata **a mitad de su propia secuencia**, así que
  nunca hay healthcheck ni rollback (era el eslabón AUD3-20). `detached` **no** basta:
  da sesión propia, no saca del cgroup. Está en `krakenos.service.example` y en la
  unidad que escribe el instalador; si despliegas con una unidad propia, añádelo.
- **Regla sudoers para reiniciar el servicio.** El agente no corre como root. El
  instalador genera `/etc/sudoers.d/krakenos-update` (validado con `visudo -cf`) con el
  ámbito mínimo — `restart`, `stop` y `start` de **esa** unidad, nada más:

  ```
  krakenos ALL=(root) NOPASSWD: /usr/bin/systemctl restart krakenos
  krakenos ALL=(root) NOPASSWD: /usr/bin/systemctl stop krakenos
  krakenos ALL=(root) NOPASSWD: /usr/bin/systemctl start krakenos
  ```

  (`stop`/`start` los usa el rollback.) Sin esto, el paso `restart` falla y se revierte.

- Ajusta `KRAKENOS_SERVICE_NAME` si tu unidad tiene otro nombre, y `KRAKENOS_REPO_DIR`
  si el repo no está dos niveles por encima de `apps/agent`.

### Las deps opcionales sobreviven al update

`tuyapi` y `@matter/main` no están en `package.json` a propósito (`node-ssh`, `mqtt`,
`net-snmp` y `ws` sí, y no necesitan manifiesto), así que `pnpm install --frozen-lockfile` **las poda** en
cada actualización: antes el usuario perdía su router SSH o su zigbee2mqtt
sin ningún aviso. Ahora la lista vive en `apps/agent/data/extra-deps.json` (untracked,
sobrevive al `git checkout`) y el paso `apply` la reinstala.

- El instalador ya no lo escribe: créalo a mano.
- Es un JSON con nombres de paquete (`["tuyapi"]`); puedes editarlo a mano: es un JSON con nombres de paquete (`["mqtt","ws"]`).
- Si la reinstalación falla, la actualización **no** se revierte por ello: avisa en el
  log (`journalctl -u krakenos`) diciendo qué instalar a mano. Un paquete abandonado en
  el registro no debe dejarte en un bucle de rollback.

### Si se queda «en curso» para siempre

El lock de `var/update.lock` lleva **PID y hora**: si el actualizador murió,
o lleva más de 20 minutos, deja de contar como «en curso» y puedes volver a intentarlo.
Para el caso contrario —un actualizador **vivo pero atascado**, p. ej. un `pnpm install`
esperando a una red que no vuelve— la tarjeta ofrece **«Cancelar actualización»**
(`POST /api/system/update/cancel`, admin, auditado): libera el lock sin matar el
proceso, así que si termina escribirá su resultado igualmente.

### Ventana de mantenimiento (opcional)

En **Ajustes → Sistema** puedes fijar una franja `HH:MM-HH:MM` (hora local) en la que
se permite actualizar (soporta el cruce de medianoche, p. ej. `02:00-06:00`). Fuera de
ella, «Actualizar ahora» avisa y no lanza nada; un admin puede forzarlo igualmente.

### Instalación por paquete (`.deb` y Arch) — manifiesto firmado

En una instalación hecha con el `.deb` o el paquete de Arch, **Actualizar ahora** descarga la
versión nueva de las releases de GitHub y la instala con el gestor de paquetes del sistema.
Como instala software como root, **no se fía de nada que no pueda comprobar**:

1. **Manifiesto firmado.** Cada release publica un `manifest.json` y su firma `manifest.json.sig`
   (ed25519). La clave pública va dentro del agente; la privada solo existe en la CI de
   publicación. Sin firma válida no se descarga el paquete.
2. **Suma y tamaño.** El paquete descargado debe coincidir con el `sha256` y el tamaño que declara
   el manifiesto firmado.
3. **Solo hacia delante.** Se rechaza una versión igual o anterior a la instalada (aunque venga
   con firma válida: un manifiesto viejo servido de nuevo no sirve para volver atrás), y una
   versión que declare un `minFrom` mayor que la instalada (hay que pasar antes por una intermedia).
4. **Solo desde el repositorio configurado** (`UPDATE_CHECK_REPO`), por la política de salida del
   agente.
5. **Root lo comprueba otra vez.** El agente corre sin privilegios y el paquete pasó por un
   directorio suyo. El helper de root copia el paquete a un directorio que solo es de root y
   vuelve a verificar firma, suma y versión sobre **su copia**, con su propio verificador;
   solo entonces instala, en una unidad transitoria de systemd fuera del espacio de montaje del
   servicio.

Cada rechazo se muestra en la tarjeta con su motivo (firma, paquete que no coincide, versión no
más nueva, versión intermedia necesaria, sin paquete para tu sistema) y **no se instala nada**.

**Rollback.** Antes de empezar se guarda una copia consistente de la base. Si la instalación o el
chequeo de salud posterior fallan, el helper restaura esa copia y reinstala el paquete anterior,
y la tarjeta lo dice. La **primera** actualización por paquete no tiene un paquete anterior al que
volver: en ese caso se restaura la base y se arranca el servicio, pero la versión instalada no
retrocede, y la tarjeta lo indica para que reinstales a mano el paquete que tenías.

**Requisito: el helper de root.** La instalación usa el mismo helper que la VPN, el cortafuegos y
la QoS, cuya regla de sudoers **no se instala por defecto**. Si no está activo, la tarjeta no
ofrece el botón y muestra el comando para activarlo (una vez, en el servidor):

```bash
sudo krakenos-setup --with-helper
```

Si prefieres no activarlo, actualiza con el gestor de paquetes del sistema como siempre.

**Paquete portable (carpeta `.tar.gz`).** No se actualiza desde la app: se reemplaza la carpeta por la
de la versión nueva y los datos, que viven fuera de ella, se conservan (ver
[Paquete portable](../README.md#paquete-portable-carpeta)). El lanzador del portable arranca el agente
en modo `package`, pero sin el helper de administrador la tarjeta **no ofrece** el botón «Actualizar
ahora». Además, la comprobación de versiones está apagada hasta que definas `UPDATE_CHECK_REPO` en el
`.env` de la carpeta de datos; si la activas, la tarjeta avisa de la versión nueva y, como el portable no
trae `krakenos-setup`, el comando que sugiere para activar el helper no existe en él: ignóralo y
reemplaza la carpeta.

**Windows.** La actualización desde la app para el instalador de Windows llega más adelante; hoy
en Windows se instala la versión nueva a mano, ejecutando el instalador nuevo encima (ver
[Instalar en Windows](install-windows.md#actualizar)).

### Docker — comando manual (honesto)

El contenedor **no puede auto-reemplazarse**, así que la tarjeta muestra el comando a
ejecutar en el host en lugar del botón:

```bash
docker compose pull && docker compose up -d
```

### Recomendación

Aunque el bare-metal hace un snapshot de la DB para el rollback, haz también una
**copia de seguridad cifrada** antes de una actualización importante (Ajustes → Sistema
→ Copia de seguridad): es exportable y cubre también `keys/` y `data/`.

### Cuando una versión necesita un Node más nuevo

La actualización con un clic corre sin permisos de administrador, así que no puede cambiar el Node del
sistema. Antes de aplicar nada, comprueba qué versión de Node exige la versión de destino: si la del
equipo no llega, se niega sin tocar la instalación y la tarjeta «Actualizaciones» explica qué hacer.
En ese caso, actualiza desde una terminal con:

    sudo bash scripts/install.sh --update

El instalador sube Node a la versión necesaria y después aplica la actualización.
