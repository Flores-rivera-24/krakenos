# Rotación de claves RS256 (JWT) — guía de operación (US-64)

KrakenOS firma los JWT (access, refresh y `mfa-pending`) con un par de claves
**RS256**: privada en disco para firmar, pública para verificar (`keys/`,
gitignored, generadas con `scripts/gen-keys.sh`). Esta guía explica cómo **rotar**
ese par —por caducidad periódica o porque la clave privada se vea comprometida—
**sin cerrar todas las sesiones**.

## Cómo lo soporta el agente

- Cada JWT lleva en su cabecera un **`kid`** (key id) **derivado** de la clave
  pública que lo firmó (`sha256` del PEM, truncado). No hace falta metadato aparte:
  el mismo PEM siempre produce el mismo `kid`.
- Al verificar, el agente elige la clave pública cuyo `kid` coincide con el del
  token. Mantiene un **llavero** (`src/auth/keyring.ts`) con la clave **actual**
  (firma + verifica) y cero o más claves **previas** (solo verifican).
- Durante el **solape** de una rotación, los tokens aún válidos firmados con la
  clave anterior siguen verificando contra su clave pública previa. Así un
  refresh token de 30 días emitido antes de rotar **no** se invalida de golpe.
- Un token **sin** `kid` (emitido antes de US-64) cae a la clave actual, de modo
  que el primer despliegue de esta versión no cierra sesiones.

Variables de entorno (ver `.env.example`):

| Variable | Uso |
|---|---|
| `JWT_PRIVATE_KEY_PATH` / `JWT_PUBLIC_KEY_PATH` | Par **actual** (firma + verifica). |
| `JWT_PREVIOUS_PUBLIC_KEY_PATHS` | Claves públicas **previas** (rutas separadas por comas). Solo verifican durante el solape; nunca firman. |

> La rotación se aplica **al reiniciar** el agente (lee las claves al arrancar). No
> es en caliente, pero es **graciosa**: con la clave previa configurada, las
> sesiones existentes siguen vivas hasta que sus tokens caduquen o se refresquen.

## Procedimiento

Con el helper `scripts/rotate-keys.sh` (recomendado):

```bash
cd apps/agent
./scripts/rotate-keys.sh          # conserva la pública actual como .prev y genera un par nuevo
```

Luego:

1. Configura la clave previa en el `.env`:
   ```
   JWT_PREVIOUS_PUBLIC_KEY_PATHS=./keys/jwt-public.prev.pem
   ```
2. **Reinicia** el agente (`systemctl restart krakenos` o el proceso). Desde aquí
   firma con la clave **nueva** (kid nuevo) y verifica con la **nueva y la previa**.
3. Espera a que termine el **solape**: al menos `REFRESH_TOKEN_TTL` (30 días por
   defecto), o menos si fuerzas a los usuarios a reloguear. Pasado ese tiempo ya no
   quedan tokens firmados con la clave previa.
4. **Retira** la clave previa: borra `keys/jwt-public.prev.pem`, quita
   `JWT_PREVIOUS_PUBLIC_KEY_PATHS` del `.env` y **reinicia** de nuevo.

### Compromiso de la clave privada (rotación urgente)

Si la clave privada se ha visto comprometida, **no** quieres mantener un solape
largo. Tras rotar (pasos 1–2), invalida de inmediato las sesiones existentes:

- Llama a `POST /api/system/regen-keys` (admin): revoca **todos** los refresh
  tokens en la base de datos. Los access tokens ya emitidos caducan solos en
  `ACCESS_TOKEN_TTL` (15 min por defecto).
- Retira la clave previa cuanto antes (paso 4) para que ningún token firmado con
  la clave comprometida verifique.

> **Aclaración sobre `regen-keys`:** ese endpoint **no** rota el par RS256 en disco
> ni en caliente — solo revoca los refresh tokens. La rotación real de claves es
> este procedimiento (rotate-keys.sh + reinicio). Combínalos para una respuesta
> completa a un compromiso.

## Verificación rápida tras rotar

- Inicia sesión: el nuevo access token debe traer el `kid` nuevo en su cabecera
  (`jwt.io` o decodificando el primer segmento en base64url).
- Una sesión abierta **antes** de rotar debe seguir funcionando (su refresh token,
  firmado con la clave previa, se acepta y al refrescar emite tokens con el kid
  nuevo).
- Tras retirar la clave previa, esa sesión antigua deja de refrescar y exige
  volver a iniciar sesión.
