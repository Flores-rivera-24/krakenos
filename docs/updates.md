# Actualizaciones (US-116 comprobación · US-190 one-click con rollback · US-232 cadena real)

KrakenOS puede avisarte cuando hay una versión más nueva publicada como *release* en
GitHub. La comprobación es **opcional**: sin configuración, el agente **no hace
ninguna llamada externa** (coherente con la postura "sin nube de terceros").

## Activarlo

Si instalaste con `scripts/install.sh`, **ya está activo**: el instalador escribe
`UPDATE_CHECK_REPO` en el `.env` que genera (US-232), porque sin él no hay releases
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
  y compara el `tag_name` (p. ej. `v1.2.0`) con tu versión por *major/minor/patch*.
- El resultado se **cachea 1 hora** para no golpear la API de GitHub en cada carga
  de la página (el límite sin autenticar es de 60 peticiones/hora por IP).
- Cualquier fallo de red o respuesta inesperada **degrada en silencio** a "sin datos"
  (`latest: null`), nunca rompe la página.
- El endpoint (`GET /api/system/update-check`) es **lectura autenticada**; no expone
  la versión a usuarios no autenticados (ver `PUBLIC_VERSION`, US-83).

## Aplicar la actualización one-click (US-190)

Desde **Ajustes → Sistema → Actualizaciones**, un admin puede aplicar la actualización
sin tocar la terminal. El comportamiento depende del **modo de despliegue** (se detecta
solo: `KRAKENOS_DEPLOY_MODE`, luego `/.dockerenv`, si no → `systemd`):

### Bare-metal / systemd — actualización automática con rollback

Al pulsar **«Actualizar ahora»**, el agente lanza un **proceso actualizador aparte**
(`dist/update-runner.js`) que corre esta secuencia (orquestador puro
`update-orchestrator.ts`, verificado en tests con un runner inyectable):

1. **backup** — snapshot consistente de la base SQLite a `<db>.pre-update` con
   `VACUUM INTO` (US-232: con WAL activo —US-228— una copia del fichero a secas se
   dejaría atrás lo que aún no está en el fichero principal) y anota el commit actual.
2. **fetch** — `git fetch --tags` y verifica que existe la etiqueta `v<versión>`.
3. **apply** — `git checkout` de la etiqueta + `pnpm install --frozen-lockfile` +
   `pnpm build` + **reinstalación de las deps opcionales** (abajo).
4. **migrate** — `prisma migrate deploy`.
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
ejecución real se verifica en despliegue (US-86).

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

`node-ssh`, `mqtt`, `net-snmp`, `ws`, `tuyapi` y `@matter/main` no están en
`package.json` a propósito, así que `pnpm install --frozen-lockfile` **las poda** en
cada actualización: antes de US-232 el usuario perdía su router SSH o su zigbee2mqtt
sin ningún aviso. Ahora la lista vive en `apps/agent/data/extra-deps.json` (untracked,
sobrevive al `git checkout`) y el paso `apply` la reinstala.

- El instalador lo escribe con `--with-deps` / `--with-all`.
- Puedes editarlo a mano: es un JSON con nombres de paquete (`["mqtt","ws"]`).
- Si la reinstalación falla, la actualización **no** se revierte por ello: avisa en el
  log (`journalctl -u krakenos`) diciendo qué instalar a mano. Un paquete abandonado en
  el registro no debe dejarte en un bucle de rollback.

### Si se queda «en curso» para siempre

El lock de `var/update.lock` lleva **PID y hora** (US-232): si el actualizador murió,
o lleva más de 20 minutos, deja de contar como «en curso» y puedes volver a intentarlo.
Para el caso contrario —un actualizador **vivo pero atascado**, p. ej. un `pnpm install`
esperando a una red que no vuelve— la tarjeta ofrece **«Cancelar actualización»**
(`POST /api/system/update/cancel`, admin, auditado): libera el lock sin matar el
proceso, así que si termina escribirá su resultado igualmente.

### Ventana de mantenimiento (opcional)

En **Ajustes → Sistema** puedes fijar una franja `HH:MM-HH:MM` (hora local) en la que
se permite actualizar (soporta el cruce de medianoche, p. ej. `02:00-06:00`). Fuera de
ella, «Actualizar ahora» avisa y no lanza nada; un admin puede forzarlo igualmente.

### Docker — comando manual (honesto)

El contenedor **no puede auto-reemplazarse**, así que la tarjeta muestra el comando a
ejecutar en el host en lugar del botón:

```bash
docker compose pull && docker compose up -d
```

### Recomendación

Aunque el bare-metal hace un snapshot de la DB para el rollback, haz también una
**copia de seguridad cifrada** antes de una actualización importante (Ajustes → Sistema
→ Copia de seguridad, US-103): es exportable y cubre también `keys/` y `data/`.
