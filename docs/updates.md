# Actualizaciones (US-116 comprobación · US-190 one-click con rollback)

KrakenOS puede avisarte cuando hay una versión más nueva publicada como *release* en
GitHub. Es **opcional y está desactivado por defecto**: sin configuración, el agente
**no hace ninguna llamada externa** (coherente con la postura "sin nube de terceros").

## Activarlo

Define el repositorio de GitHub en el entorno del agente:

```bash
UPDATE_CHECK_REPO=tu-usuario/krakenos
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

1. **backup** — copia la base SQLite viva a `<db>.pre-update` y anota el commit actual.
2. **fetch** — `git fetch --tags` y verifica que existe la etiqueta `v<versión>`.
3. **apply** — `git checkout` de la etiqueta + `pnpm install --frozen-lockfile` + `pnpm build`.
4. **migrate** — `prisma migrate deploy`.
5. **restart** — `systemctl restart <servicio>` (por eso corre en un proceso aparte:
   sobrevive al reinicio del agente).
6. **healthcheck** — sondea `/health/ready` unos segundos.

Si **cualquier paso tras el backup falla** (o el healthcheck no pasa), hace
**rollback** automático: restaura la DB previa, vuelve al commit anterior y reinicia.
El proceso es **one-shot** → nunca entra en un bucle de reinicio. El resultado
(correcta / revertida) se guarda en `var/update-result.json` y se muestra en la tarjeta
al volver.

**Requisitos en el servidor** (verificar en el despliegue real, US-86):

- El servicio corre bajo systemd (`krakenos.service`); ajusta `KRAKENOS_SERVICE_NAME`
  si tu unidad tiene otro nombre, y `KRAKENOS_REPO_DIR` si el repo no está dos niveles
  por encima de `apps/agent`.
- El usuario del agente necesita poder reiniciar su servicio sin contraseña. Añade a
  la regla sudoers (junto al helper de privilegios existente):

  ```
  krakenos ALL=(root) NOPASSWD: /usr/bin/systemctl restart krakenos
  ```

  (o usa una regla polkit equivalente). Sin esto, el paso `restart` falla y se revierte.

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
