# Driver Cisco IOS (US-37) — switches/routers Catalyst

Activa el control de un switch o router **Cisco IOS / IOS-XE** (Catalyst 2960, 3560, 3750,
9000, routers con IOS) desde KrakenOS, vía SSH + CLI de IOS. Mismo patrón que el driver OpenWrt:
transporte SSH inyectable + builders/parsers puros + unit tests sin hardware.

> **No aplica** a Cisco Meraki (solo gestión por nube → viola el principio local-first) ni a
> Cisco Small Business (sin CLI IOS). Para IOS-XE 16.6+ existe una alternativa NETCONF (US-39).

## Requisitos

- IOS 12.x+ con SSH habilitado (`ip ssh version 2`).
- Usuario local con privilegios para `show` y, para el bloqueo, modo `enable` + `configure terminal`.
- Conectividad del servidor KrakenOS al puerto SSH del dispositivo (por defecto 22).

## Habilitar SSH en un switch Cisco

```
enable
configure terminal
 hostname SW1
 ip domain-name casa.local
 crypto key generate rsa modulus 2048
 username admin privilege 15 secret TU_PASSWORD
 line vty 0 4
  transport input ssh
  login local
 ip ssh version 2
end
write memory
```

Si usas contraseña de `enable` aparte del login, configúrala con `enable secret TU_ENABLE` y
ponla en `CISCO_ENABLE_PASSWORD`.

## Instalación de la dependencia SSH

`node-ssh` es un **import perezoso** (no está en `package.json`); instálalo en el servidor:

```bash
cd apps/agent && pnpm add node-ssh
```

## Variables de entorno

```env
DRIVER_KIND=cisco-ios
DRIVER_HOST=192.168.1.254            # IP del switch/router Cisco
CISCO_USER=admin
CISCO_PASSWORD=                      # contraseña SSH
CISCO_SSH_PORT=22
CISCO_ENABLE_PASSWORD=               # contraseña de enable (si aplica)
CISCO_INTERFACE=GigabitEthernet0/0   # interfaz WAN para métricas de tráfico
CISCO_BLOCK_VLAN=1                   # VLAN de las entradas de bloqueo estáticas
```

## Qué hace el driver

| Capacidad | Comando IOS | Notas |
|---|---|---|
| Descubrimiento | `show arp` | IP+MAC (normaliza `xxxx.xxxx.xxxx` → `xx:xx:xx:xx:xx:xx`). |
| Tráfico WAN | `show interfaces <iface>` | Bytes rx/tx → tasa por delta entre muestras. |
| Bloqueo | `mac address-table static <mac> vlan <vlan> drop` | Entrada estática `drop`; `no …` para desbloquear. |
| Versión | `show version` | Modelo, versión IOS, uptime (para la integración de Ajustes). |
| VLANs | `show vlan brief` | Inventario de VLANs (lo consume US-38). |

**No soportado:** WiFi (los switches Cisco gestionados no tienen radio → los métodos WiFi lanzan
un error claro y multi-AP devuelve vacío) y descubrimiento por hostname/mDNS (`scanMdns` vacío).

## IOS vs IOS-XE

- **IOS** (clásico): solo CLI por SSH → este driver (`cisco-ios`).
- **IOS-XE 16.6+**: además expone **NETCONF** (XML estructurado, transaccional) en el puerto 830.
  El driver `cisco-netconf` (US-39) lo usa cuando está disponible; `cisco-ios` sigue siendo el
  default para hardware más antiguo.

## Verificación end-to-end

1. `DRIVER_KIND=cisco-ios` + `DRIVER_HOST`/credenciales en `.env`, `pnpm add node-ssh`, reinicia el agente.
2. `GET /health` → `{ driver: "cisco-ios" }`.
3. El inventario se puebla con los dispositivos de `show arp`.
4. Bloquea un dispositivo desde la UI → comprueba en el switch: `show mac address-table | include drop`.
5. El monitor de tráfico muestra tasa de la interfaz `CISCO_INTERFACE`.
