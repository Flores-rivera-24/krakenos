# Recuperación ante desastres

Runbook rápido para cuando algo va mal en tu servidor KrakenOS. Está pensado para leerlo con
prisa: **síntoma → causa → qué hacer**. Antes de tocar nada, si puedes, **haz una copia del
directorio de datos** (`data/`, `keys/` y el `.db`) para no empeorar la situación.

> **Dónde vive el estado:** la base de datos SQLite (`apps/agent/prisma/dev.db` en dev, o el
> volumen `/data` en Docker), las claves RS256 (`keys/`) y las credenciales de integración
> (`data/`). Tus **copias de seguridad cifradas** son los ficheros **`.kbk`** que exportaste
> desde **Ajustes → Sistema → Copia de seguridad** (guárdalos fuera del servidor).

---

## 1. La base de datos está corrupta / el agente no arranca

**Síntoma:** el agente no levanta; en el log aparecen errores de SQLite (`database disk image is
malformed`, `file is not a database`, `SQLITE_CORRUPT`) o Prisma falla al conectar.

**Causa habitual:** apagón o `kill -9` a media escritura, disco lleno (ver §2), o un fichero `.db`
truncado.

**Qué hacer (en orden de preferencia):**

1. **Restaurar desde una copia cifrada (lo normal).** Si el agente aún arranca lo justo para
   servir la UI, ve a **Ajustes → Sistema → Restaurar**, sube tu `.kbk` y su contraseña. La
   restauración se prepara en *staging* y **se aplica al reiniciar** de forma atómica (con
   rollback si algo falla), así que nunca entra en bucle de arranque. Cubre DB + `keys/` + `data/`.
2. **Si la UI no carga**, restaura fuera de banda: detén el servicio, sustituye el `.db`/`keys/`/
   `data/` por los de un backup previo bueno (o descifra tu `.kbk` en otra máquina que sí arranque)
   y vuelve a arrancar.
3. **Recuperación manual de SQLite (último recurso, sin backup).** Con el servicio parado:

   ```bash
   sqlite3 dev.db "PRAGMA integrity_check;"          # confirma el daño
   sqlite3 dev.db ".recover" | sqlite3 dev.recovered.db
   # revisa dev.recovered.db y, si está bien, reemplaza el original
   ```

   `.recover` rescata lo que se pueda; puede haber pérdida parcial. Por eso las copias `.kbk`
   periódicas son la red de seguridad real.

---

## 2. Disco lleno

**Síntoma:** las escrituras fallan; SQLite lanza `disk I/O error` o `database or disk is full`;
el agente no puede auditar ni guardar muestras.

**Causa:** crecimiento de logs (del servicio o de Docker), acumulación de muestras de tráfico/
energía, grabaciones de cámara o backups viejos en disco.

**Qué hacer:**

1. Mira qué llena el disco:

   ```bash
   df -h                     # cuánto queda
   du -sh apps/agent/data/* apps/agent/prisma/*.db   # qué pesa dentro de KrakenOS
   ```

2. **Poda de KrakenOS:** en **Ajustes** ajusta la **retención** (tráfico, auditoría, energía,
   grabaciones). El barrido de retención corre cada 6 h; bajar los días recupera espacio en el
   siguiente pase. Las grabaciones de cámara también se podan por tamaño total (MB).
3. **Logs de Docker** (frecuente): ver §4.
4. Tras liberar espacio, reinicia el agente para que SQLite pueda volver a escribir.

---

## 3. Contraseña de admin perdida

**Síntoma:** no puedes entrar como administrador y no hay otro admin activo.

**Realidad (sin inventar features):** KrakenOS **no** tiene un "olvidé mi contraseña" por email
—no depende de la nube—. **No hay reset self-service sin acceso a la base de datos.** El cambio de
contraseña propio (Ajustes → Cuenta) exige la contraseña actual.

**Vías de recuperación:**

- **Otro admin.** Si existe otro usuario con rol admin activo, que entre y te resetee la
  contraseña desde **Ajustes → Usuarios**.
- **Acceso a la DB (control físico del servidor).** Con acceso al host puedes recrear el admin
  reejecutando el *seed* sobre una base sin usuarios, o crear/ajustar el usuario admin
  directamente en la tabla `User` de SQLite (la contraseña es un hash; hay que escribir un hash
  válido, no texto plano). Esto es deliberadamente manual: quien controla el disco controla la
  instancia.
- **Restaurar** un backup `.kbk` anterior a la pérdida (§1) si en él recuerdas la contraseña.

---

## 4. Los logs de Docker sin rotar llenan el disco

**Síntoma:** `/var/lib/docker/containers/**/*-json.log` crece sin límite y agota el disco (deriva
en el §2).

**Causa:** por defecto el driver de logs `json-file` de Docker **no rota**. KrakenOS es verboso en
arranque y auditoría.

**Qué hacer:**

- Comprueba el tamaño del log del contenedor:

  ```bash
  docker ps                                  # localiza el contenedor
  du -sh $(docker inspect --format='{{.LogPath}}' krakenos)
  docker logs --tail 100 krakenos            # inspección puntual
  ```

- **Limita la rotación** con el bloque `logging:` de `docker-compose.yml` (rotación por tamaño y
  número de ficheros, p. ej. `max-size: "10m"` y `max-file: "3"`) y recrea el contenedor
  (`docker compose up -d`). A partir de ahí Docker rota solo.
- Para vaciar de inmediato un log ya enorme, recrear el contenedor (`docker compose down && up -d`)
  arranca con logs limpios.

---

> Si nada de esto desbloquea el arranque, conserva intactos el `.db`, `keys/` y `data/` actuales
> (cópialos aparte) antes de seguir experimentando: son lo que necesita cualquier recuperación
> posterior.
