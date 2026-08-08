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
—no depende de la nube, y el correo saliente es opcional y viene apagado— ni un endpoint que
resetee la contraseña sin credenciales: eso sería una puerta abierta en un panel de administración
de red. Lo que sí hay es una vía **con una credencial que tú guardaste antes**: los códigos de
recuperación.

**Vías de recuperación, en orden:**

1. **Tu código de recuperación.** En la pantalla de acceso, **«¿No puedes entrar?»** → introduce tu
   correo y uno de los diez códigos que generaste en **Ajustes → Seguridad**. Entras sin la
   contraseña y la cambias en **Ajustes → Cuenta**. Cada código sirve **una sola vez**, el intento
   cuenta para el bloqueo por intentos fallidos igual que una contraseña, y el acceso queda
   **auditado y avisa por push** — si no fuiste tú, hay que enterarse.
   > Si nunca generaste códigos, esta vía no existe para ti: genéralos **ahora**, antes de
   > necesitarlos. Es lo único de esta lista que no requiere ni otro admin ni entrar al servidor.
2. **Otro admin.** Si existe otro usuario con rol admin activo, que entre y te resetee la
   contraseña desde **Ajustes → Usuarios**.
3. **`reset-admin` en el servidor**. Crea el admin si no existe, o resetea el que hay
   —contraseña, rol `admin` y cuenta **activa**— y revoca sus sesiones abiertas:

   ```bash
   cd /opt/krakenos/apps/agent
   sudo -u krakenos node dist/reset-admin.js tu@correo.com            # genera una contraseña temporal
   sudo -u krakenos node dist/reset-admin.js tu@correo.com 'MiClave1' # o la que tú digas (≥10, con letra y dígito)
   ```

   Imprime la contraseña temporal por pantalla; cámbiala al entrar (Ajustes → Cuenta). Corre con
   el **usuario del servicio** para no dejar ficheros propiedad de root. No hace falta parar el
   agente. En Docker: `docker compose exec krakenos node dist/reset-admin.js tu@correo.com`.
4. **Restaurar** un backup `.kbk` anterior a la pérdida (§1), si en él recuerdas la contraseña.

> Lo que **no** funciona (y antes esta guía sugería): reejecutar `pnpm db:seed`. El seed hace un
> `upsert` con `update: {}`, así que si el usuario ya existe **no cambia nada**; y sobre una base
> con usuarios el wizard `/setup` responde 409.

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

---

## 5. La tarjeta SD se ha quedado en solo-lectura

**Síntoma:** la app carga y se ve, pero **nada se guarda**: los cambios de ajustes no persisten,
la auditoría no crece, las copias fallan. `/health/ready` responde **503** (escribe un
canario, así que detecta esto; antes respondía 200 alegremente). En el journal:
`SQLITE_READONLY` o `attempt to write a readonly database`.

**Causa:** es el final típico de una microSD gastada — el kernel detecta errores de escritura y
remonta el sistema de ficheros como `ro` para protegerlo.

**Qué hacer:**

1. Confirma el diagnóstico:

   ```bash
   mount | grep ' / '                 # ¿aparece "ro," en las opciones?
   dmesg | tail -30                   # errores de E/S de la tarjeta
   journalctl -u krakenos -n 50       # el aviso del canario de readiness
   ```

2. **No reescribas la tarjeta.** Copia lo que puedas a otro medio (en solo-lectura se puede leer):
   el `.db` (con su `-wal`), `keys/` y `data/`, más las copias de `data/backups/` si las hay.
3. Graba una tarjeta nueva, instala KrakenOS y **restaura** desde el `.kbk` más reciente (§1) o
   coloca a mano el `.db`/`keys/`/`data/` que rescataste.
4. Para la próxima: activa las **copias automáticas** (Ajustes → Sistema → Copia de seguridad) y
   llévate los `.kbk` fuera del servidor. Una copia que vive en el disco que muere no es una copia.

---

## 6. La actualización se quedó «en curso» y no avanza

**Síntoma:** la tarjeta de Actualizaciones dice «Actualización en curso…» y no cambia.

**Causa:** el proceso actualizador murió (o se atascó, p. ej. `pnpm install` esperando una red que
no vuelve) dejando su lock en `var/update.lock`.

**Qué hacer:** desde **Ajustes → Sistema → Actualizaciones**, pulsa **«Cancelar actualización»**
(libera el lock; no mata el proceso, así que si sigue vivo terminará y escribirá su resultado). El
lock además **caduca solo** si su proceso ya no existe o pasan 20 minutos, así que muchas veces basta
con esperar y recargar. Como último recurso, con el servicio parado: `rm /opt/krakenos/apps/agent/var/update.lock`.
El resultado de la última actualización está en `var/update-result.json`.

---

## 7. Se ha perdido `secretbox.key`

**Síntoma:** el agente arranca, pero las integraciones configuradas desde la UI dejan de conectar y
en el log aparecen fallos al descifrar secretos. La contraseña de las copias automáticas tampoco se
puede leer.

**Causa:** `keys/secretbox.key` es la clave que cifra **en reposo** los secretos guardados en la
base (credenciales de router, contraseña del broker MQTT, contraseña de la copia automática). Sin
ella, esos valores son bytes sin sentido: no hay puerta trasera, y eso es a propósito.

**Qué hacer:**

1. Si tienes un backup `.kbk`, **restáuralo** (§1): el archivo incluye `keys/`, así que recupera la
   clave y con ella los secretos.
2. Si no lo tienes, la base sigue siendo válida: lo único perdido son los **secretos cifrados**. El
   agente genera una `secretbox.key` nueva al arrancar; entra y **vuelve a introducir** las
   credenciales de cada integración (Conectar → cada integración → Guardar) y regenera la
   contraseña de las copias automáticas. Usuarios, dispositivos, histórico, reglas y planos no se
   pierden.

> No borres nunca `keys/` "para empezar de cero" sin haber exportado antes una copia: ahí viven
> también las claves RS256 de las sesiones.

---

> Si nada de esto desbloquea el arranque, conserva intactos el `.db`, `keys/` y `data/` actuales
> (cópialos aparte) antes de seguir experimentando: son lo que necesita cualquier recuperación
> posterior.
