# Activar el driver ASUS / Asuswrt-Merlin

El driver `asus` (US-70) lee el inventario y gestiona la WiFi de routers ASUS (RT-AX88U,
RT-AX86U, ZenWifi AX XT8, TUF-AX5400…) a través de `appGet.cgi` (lectura) y `applyapp.cgi`
(escritura), con **Basic Auth**, sobre un transporte inyectable. Funciona con el firmware
**stock de ASUS** y con **Asuswrt-Merlin**.

No hay nada que programar: solo habilitar el acceso LAN y configurar el `.env`.

---

## 0. Antes de empezar

- El driver habla con la **web admin del router** (la misma del navegador). Mantén el router en
  tu LAN; no expongas la admin a internet.
- Algunas respuestas de `appGet.cgi` cambian entre versiones de firmware; el parser tolera tanto
  el JSON de ASUS como el formato `clave=valor`.

## 1. Habilitar el acceso LAN

1. En la UI del router: **Administration → System**.
2. **Local Access Config**: asegúrate de que el acceso web LAN está habilitado (HTTP o HTTPS).
3. Si activas **HTTPS** para la admin, usa `ASUS_HTTPS=true` (certificado autofirmado).
4. Anota usuario y contraseña de administración del router.

## 2. Stock vs Asuswrt-Merlin

- **Stock ASUS**: funciona para inventario, tráfico y WiFi. El **bloqueo por MAC** usa el filtro
  MAC del firmware (ver limitaciones).
- **Asuswrt-Merlin**: mismo API + más estable para automatización. Recomendado si vas a usar el
  bloqueo con frecuencia.

## 3. Configurar el `.env` del agente

```bash
DRIVER_KIND=asus
ASUS_HOST=192.168.1.1       # o deja DRIVER_HOST
ASUS_USERNAME=admin
ASUS_PASSWORD=********
ASUS_HTTPS=false            # true si la admin del router usa https
```

Reinicia el agente. En `/inventory` verás los clientes y en `/wifi` los SSID de 2.4/5 GHz.

## 4. Cómo funciona el bloqueo por MAC

`blockDevice` lee la lista `MULTIFILTER_MAC`, añade la MAC y aplica
(`MULTIFILTER_ENABLE=1`, `MULTIFILTER_ALL=1`, `rc_service=restart_firewall`). `unblockDevice`
quita la MAC y reaplica.

> **Limitación**: el bloqueo usa el **filtro de direcciones MAC** del firmware. Debe estar en
> modo **lista negra** (deny). Si tienes el filtro en modo **whitelist** (allow), KrakenOS no
> debe gestionarlo (bloquearía a todos los demás). Revisa **Firewall → MAC filter** antes de
> usar el bloqueo en producción.

## 5. WiFi

- `wl0_*` = banda **2.4 GHz**, `wl1_*` = banda **5 GHz**.
- Cambiar SSID/contraseña/oculto escribe la nvram correspondiente y aplica
  `rc_service=restart_wireless` (la WiFi se reinicia unos segundos).
- La **red de invitados** (`wl0.1`…) no se gestiona en este baseline: configúrala desde la UI.

## 6. Verificación con hardware real

1. **Inventario**: `get_clientlist()` lista los clientes online con nombre/fabricante.
2. **Bloqueo MAC**: bloquea uno desde `/inventory` → pierde acceso (revisa el MAC filter en la
   UI). Desbloquéalo.
3. **WiFi**: cambia el SSID de 2.4 GHz desde `/wifi` → el router lo reaplica.

## Limitaciones conocidas

- El bloqueo depende del **filtro MAC** (modo blacklist); no funciona en modo whitelist.
- El **tráfico por dispositivo** no se reporta (solo la tasa WAN agregada).
- La **red de invitados** y el detalle de clientes por banda no se modelan (baseline).
