# Activar el driver TP-Link Omada Controller

El driver `omada` (US-67) gestiona una red de APs/switches/gateways TP-Link Omada (EAP225,
EAP670, EAP773…) a través de la **API local del Omada Controller** (software, o hardware
OC200/OC300), sobre un transporte inyectable. **Solo controller local** — no se usa el portal
cloud de Omada.

No hay nada que programar: solo crear una **cuenta admin local** y configurar el `.env`.

---

## 0. Antes de empezar

- Necesitas un **Omada Controller** corriendo en tu red (paquete software en un PC/Docker, o un
  OC200/OC300). Los APs en modo *standalone* (sin controller) **no** sirven para este driver.
- El controller usa **certificado autofirmado**; la conexión es LAN a tu propio hardware (no lo
  expongas a internet).
- El driver necesita dos identificadores internos:
  - **`omadacId`**: id del controller. Se **autodetecta** vía `GET /api/info` (déjalo vacío).
  - **`siteId`**: se resuelve a partir del **nombre del site** (`OMADA_SITE_NAME`, por defecto
    `Default`) consultando los sites del usuario.

## 1. Puertos y URL

| Controller | URL típica |
|---|---|
| Software (v5) | `https://<host>:8043` |
| OC200/OC300 | `https://<host>:443` |

Pon esa URL en `OMADA_URL` (o deja `DRIVER_HOST` y se usará `https://DRIVER_HOST`).

## 2. Crear una cuenta admin local

1. Entra en el controller como administrador.
2. **Settings → Admin** (o **Account**): crea un admin **local** (no la cuenta cloud de TP-Link).
3. Dale rol con permiso sobre el site que gestiona tu red doméstica.
4. Usa ese usuario/contraseña en `OMADA_USERNAME` / `OMADA_PASSWORD`.

## 3. Obtener el `omadacId` (opcional)

El driver lo autodetecta, pero si quieres fijarlo: abre `https://<host>:8043/api/info` en el
navegador y copia el campo `omadacId` del JSON a `OMADA_OMADAC_ID`.

## 4. Configurar el `.env` del agente

```bash
DRIVER_KIND=omada
OMADA_URL=https://192.168.1.10:8043
OMADA_USERNAME=krakenos
OMADA_PASSWORD=********
OMADA_SITE_NAME=Default            # el nombre exacto de tu site
# OMADA_OMADAC_ID=                 # vacío → autodetección
```

Reinicia el agente. En `/inventory` verás los clientes y en `/wifi` los SSIDs del site.

## 5. Verificación con hardware real

1. **Clientes**: los activos aparecen online; los recientes desconectados, con hostname.
2. **Bloqueo**: bloquea uno desde `/inventory` → en Omada el cliente queda *Blocked*. Desbloquéalo.
3. **SSID**: cambia el nombre/contraseña de la red principal desde `/wifi` → el controller lo
   aplica a los APs.
4. **Sesión**: la cookie `TPOMADA_SESSIONID` se renueva sola ante un 401/407 o un errorCode de
   sesión caducada.

## Limitaciones conocidas

- **Solo un site** por instancia del agente (`OMADA_SITE_NAME`).
- El **tráfico por dispositivo** no se reporta (solo la tasa WAN agregada del dashboard).
- El **aislamiento de invitados** y el límite de ancho de banda se gestionan en el portal de
  invitados de Omada; el driver no los modela.
- Los endpoints de WLAN (`/setting/wlans`) pueden variar entre versiones mayores del controller;
  si una operación de WiFi falla, revisa el log (incluye la ruta y el errorCode).
