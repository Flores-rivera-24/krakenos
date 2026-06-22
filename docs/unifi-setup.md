# Activar el driver Ubiquiti UniFi Network

El driver `unifi` (US-65) habla con tu controller UniFi por su **API local** (HTTPS, sobre
un transporte inyectable) — no usa la nube de Ubiquiti ni el portal `unifi.ui.com`. No hay
nada que programar: solo **crear una cuenta local** en el controller y **configurar el
`.env`** del agente.

> Compatible con UniFi Dream Machine / Dream Router / UDM Pro, USG + Cloud Key, y el
> **controller self-hosted** (UniFi Network Application en Docker/Linux). Lo que cambia entre
> ellos es la URL y el puerto; los endpoints de la API son los mismos.

---

## 0. Antes de empezar

- El driver opera contra **un único site** (por defecto `default`). Si gestionas varios
  sites, elige el que controla tu red doméstica con `UNIFI_SITE`.
- El controller usa un **certificado autofirmado**. El agente lo acepta
  (`rejectUnauthorized: false`) porque es una conexión LAN a tu propio hardware; no expongas
  el controller a internet.
- Algunos endpoints varían entre versiones de firmware. Si una operación falla, revisa el log
  del agente (incluye la ruta y el código HTTP) y compara con tu versión de controller.

## 1. URL del controller

| Tipo | URL típica |
|---|---|
| UniFi OS (UDM/UDR/UDM-Pro/Cloud Key Gen2) | `https://192.168.1.1` (puerto 443) |
| Controller self-hosted (Network Application) | `https://<host>:8443` |

Con UniFi OS la API local vive bajo el mismo 443 que la UI; el driver añade el prefijo
`/v2/api/site/<site>/…` y autentica en `/api/auth/login`. Pon esa URL en `UNIFI_URL`
(o deja `DRIVER_HOST` y el driver usará `https://DRIVER_HOST`).

## 2. Crear una cuenta local (no SSO)

El login por **cuenta de Ubiquiti (SSO/cloud)** no sirve para la API local: necesitas una
**cuenta local** del controller.

1. Entra en la UI del controller como administrador.
2. **Settings → Admins → Add Admin** (en UniFi OS: **Settings → Admins & Users**).
3. Crea un admin con **"Restrict to local access only"** (cuenta local, sin email de Ubiquiti).
4. Permisos mínimos: para inventario/tráfico basta **lectura**; para **bloquear dispositivos**
   y **editar SSIDs** hace falta rol con permiso de escritura sobre el site (Network).
5. Usa ese usuario/contraseña en `UNIFI_USERNAME` / `UNIFI_PASSWORD`.

> El driver renueva la cookie de sesión (`TOKEN`) automáticamente si la API responde 401, así
> que no hace falta tocar nada cuando caduca.

## 3. Configurar el `.env` del agente

```bash
DRIVER_KIND=unifi
UNIFI_URL=https://192.168.1.1     # o https://<host>:8443 en self-hosted
UNIFI_USERNAME=krakenos           # la cuenta local del paso 2
UNIFI_PASSWORD=********
UNIFI_SITE=default                # cambia solo si gestionas varios sites
```

Reinicia el agente. En `/dashboard` deberías ver el inventario y, en `/wifi`, los SSIDs.

## 4. Verificación con hardware real

1. **Inventario**: los clientes activos aparecen online; los recientes desconectados, con
   hostname/fabricante.
2. **Bloqueo**: bloquea un dispositivo desde `/inventory` → debería perder conectividad
   (en la UI de UniFi aparece como *Blocked*). Desbloquéalo y vuelve.
3. **WiFi**: cambia el SSID o la contraseña de la red principal desde `/wifi` → el AP la
   reaplica.
4. **Sesión**: deja el agente corriendo; cuando la cookie caduque, la siguiente operación debe
   renovar la sesión sin error (cookie rota en 401).

## Limitaciones conocidas

- El **tráfico por dispositivo** no se reporta (solo la tasa WAN agregada de `stat/health`).
- El **aislamiento de invitados** y el límite de ancho de banda de la red de invitados se
  gestionan con el portal de invitados de UniFi; el driver no los modela (se reportan como
  valores por defecto).
- Solo se gestiona **un site** por instancia del agente.
