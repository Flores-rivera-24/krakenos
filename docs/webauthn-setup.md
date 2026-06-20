# WebAuthn / passkeys (2FA) — guía de configuración (US-50)

KrakenOS soporta **passkeys** (huella, Face ID, Windows Hello o llaves de hardware
tipo YubiKey) como **segundo factor opcional** al iniciar sesión.

## Qué es y cómo funciona en KrakenOS

WebAuthn es el estándar W3C de autenticación con criptografía de clave pública. El
dispositivo del usuario genera un par de claves: la **privada nunca sale del
dispositivo**; la **pública** se registra en el servidor. En cada login el navegador
firma un reto (challenge) con la clave privada y el servidor lo verifica con la pública.

En KrakenOS la passkey es **2FA, no un reemplazo de la contraseña**:

1. El usuario introduce email + contraseña.
2. Si las credenciales son correctas **y** tiene una passkey registrada, el servidor
   responde `{ requiresWebAuthn: true }` (todavía **sin** emitir tokens).
3. El navegador pide la biometría / llave; si verifica, se emite el JWT como siempre.
4. Si el usuario **no** tiene passkeys, el login es el de siempre (sin 2FA).

Las passkeys se gestionan (añadir / eliminar) desde **Ajustes → Seguridad → Passkeys**.

> **La contraseña sigue siendo el primer factor.** Si pierdes todos tus dispositivos
> con passkey, puedes seguir entrando con email + contraseña (la passkey nunca
> reemplaza la contraseña). Por eso eliminar passkeys no tiene restricciones.

## Variables de entorno

| Variable | Descripción | Ejemplo |
|---|---|---|
| `WEBAUTHN_RP_ID` | Dominio (sin protocolo) desde el que se accede a la app. | `krakenos.local` |
| `WEBAUTHN_ORIGIN` | URL completa (protocolo + host + puerto) de la app. | `https://krakenos.local:3001` |
| `WEBAUTHN_RP_NAME` | Nombre visible del Relying Party (opcional). | `KrakenOS` |

Por defecto (dev): `WEBAUTHN_RP_ID=localhost` y `WEBAUTHN_ORIGIN=http://localhost:5173`.

### ⚠️ Importante: RP_ID debe coincidir con el hostname del navegador

`WEBAUTHN_RP_ID` **tiene que coincidir** con el dominio desde el que se accede a la app.
Si accedes por **IP** (`192.168.1.x`), **WebAuthn no funciona en Chrome** (restricción de
seguridad del navegador: el RP ID debe ser un dominio válido, no una IP).

Necesitas un **hostname**:

- Añade `krakenos.local` al `/etc/hosts` del cliente apuntando a la IP del servidor, **o**
- Accede a través de la **VPN** (el dominio del peer VPN sirve como hostname).

Y ajusta `WEBAUTHN_ORIGIN` al origen exacto del navegador (mismo esquema y puerto).

### Relación con la CSP (US-48)

WebAuthn opera vía APIs nativas del navegador (`navigator.credentials`), **sin scripts
externos**, así que **no requiere cambios en la Content-Security-Policy** existente.

## Dispositivos y navegadores soportados

- Cualquier dispositivo con biometría + navegador moderno: **Chrome 67+, Safari 14+,
  Firefox 60+**.
- Llaves de hardware (YubiKey y similares) también funcionan.

## Resolución de problemas

- **No aparece el diálogo de passkey / falla siempre**: revisa que `WEBAUTHN_RP_ID` sea el
  hostname real y `WEBAUTHN_ORIGIN` el origen exacto del navegador. Accediendo por IP no
  funcionará.
- **El reto expira**: el challenge tiene una validez de 5 minutos; reintenta el flujo.
- **Cancelaste la biometría**: la UI muestra "Verificación cancelada" con opción de
  reintentar; no vuelve al formulario de contraseña.
