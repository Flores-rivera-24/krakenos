# Activar el driver MikroTik RouterOS

El driver `mikrotik` (US-66) gestiona routers MikroTik (hEX, RB4011, CRS, CCR…) en **dos
modos** seleccionables por `.env`, sobre un transporte inyectable:

| Modo | `MIKROTIK_MODE` | Requisito | Recomendado para |
|---|---|---|---|
| **REST** | `rest` (por defecto) | RouterOS **≥ 7** con el servicio `www-ssl`/`www` activo | la mayoría de routers actuales |
| **SSH+CLI** | `ssh` | acceso SSH + paquete `node-ssh` en el servidor | RouterOS **6** (sin REST) |

No hay nada que programar: el código del driver ya existe. Solo hay que **habilitar el modo**
en el router y **configurar el `.env`** del agente.

---

## 1. Modo REST (RouterOS 7)

RouterOS 7 expone una REST API bajo `/rest/`. Hay que tener activo el servicio web seguro:

```
/ip service enable www-ssl
/ip service print          # comprueba www-ssl (443) o www (80)
```

El driver habla por defecto **HTTPS** (`MIKROTIK_HTTPS=true`); si solo tienes `www` (HTTP sin
TLS) pon `MIKROTIK_HTTPS=false`. El certificado del router es autofirmado (conexión LAN a tu
propio hardware; no expongas el router a internet).

### Usuario con permisos mínimos

Crea un usuario dedicado en lugar de usar `admin`:

```
/user group add name=krakenos policy=read,api,rest-api,!ftp,!telnet
# Para bloquear dispositivos y cambiar WiFi añade también: write
/user add name=krakenos group=krakenos password=********
```

- **Solo lectura** (inventario + tráfico): `policy=read,api,rest-api`.
- **Bloqueo + WiFi**: añade `write` (escribe en `address-list`, `firewall/filter`, `wireless`).

## 2. Modo SSH (fallback RouterOS 6)

Si tu router no tiene REST (RouterOS 6), usa SSH:

```
/ip service enable ssh
```

Instala la dependencia en el **servidor** (no va en `package.json`; carga perezosa):

```bash
pnpm add node-ssh
```

El driver traduce las operaciones a comandos CLI (`/ip arp print terse`, `/ip firewall
address-list add …`) y parsea la salida `terse`.

## 3. Configurar el `.env` del agente

```bash
DRIVER_KIND=mikrotik
MIKROTIK_MODE=rest                 # o ssh
MIKROTIK_HOST=192.168.88.1         # o deja DRIVER_HOST
MIKROTIK_USER=krakenos
MIKROTIK_PASSWORD=********
MIKROTIK_WAN_IFACE=ether1          # interfaz WAN para el tráfico (ajústala a tu router)
MIKROTIK_HTTPS=true                # solo modo rest
MIKROTIK_SSH_PORT=22               # solo modo ssh
```

Reinicia el agente.

## 4. Cómo funciona el bloqueo

`blockDevice` resuelve la IP de la MAC en `/ip/arp`, garantiza que existe una **regla drop**
en `/ip/firewall/filter` que descarta la address-list `krakenos-blocked` (la crea una sola
vez) y añade la IP a esa lista con un comentario `krakenos-block:<mac>`. `unblockDevice` borra
esa entrada. La regla drop persiste (no se borra al desbloquear).

## 5. Verificación con hardware real

1. **Inventario**: `/ip/arp` + concesiones DHCP → los dispositivos aparecen con hostname.
2. **Bloqueo**: bloquea uno desde `/inventory` → comprueba `/ip firewall address-list print`
   y que pierde conectividad. Desbloquéalo.
3. **Tráfico WAN**: la tasa de `MIKROTIK_WAN_IFACE` debe reflejar el uso real.

## Limitaciones conocidas

- **WiFi**: solo si el router tiene interfaz `wireless`. Routers sin WiFi (hEX, RB4011, CRS,
  CCR) lanzan `FeatureNotSupportedError` en las operaciones WiFi y no aparecen como AP.
- La **seguridad WiFi** real (WPA2/WPA3) y la contraseña viven en `security-profile` (menú
  aparte): el driver reporta `wpa2` como baseline y no escribe la contraseña.
- No hay **red de invitados** estándar en RouterOS: esas operaciones lanzan
  `FeatureNotSupportedError`.
- El **tráfico por dispositivo** no se reporta (solo la tasa WAN agregada).
