# Comprobación de actualizaciones (US-116)

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

## Aplicar la actualización

El aviso es **solo informativo**: KrakenOS no se auto-actualiza. Actualiza como
despliegues normalmente:

- **Docker:** `docker compose pull && docker compose up -d`.
- **Sistemd/fuente:** `git pull` + `pnpm prod` (aplica migraciones y reconstruye).

Haz siempre una **copia de seguridad** antes (Ajustes → Sistema → Copia de seguridad).
