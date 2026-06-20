# Driver Cisco NETCONF (US-39) — IOS-XE 16.6+

Alternativa **moderna y transaccional** al driver `cisco-ios` (US-37): en vez de parsear la salida
del CLI, habla **NETCONF** (XML estructurado sobre SSH, puerto 830) usando los modelos YANG
operacionales de IOS-XE. Más robusto y con cambios atómicos (`edit-config`).

> Es **opcional**: úsalo solo si tu hardware tiene **IOS-XE 16.6+**. Para IOS clásico u hardware
> más antiguo, el driver `cisco-ios` (SSH+CLI) sigue siendo el default.

## Requisitos

- IOS-XE **16.6 o superior**.
- NETCONF habilitado (escucha en el puerto 830).
- Usuario con privilegios para `get` y `edit-config`.

## Habilitar NETCONF en IOS-XE

```
configure terminal
 netconf-yang
 username admin privilege 15 secret TU_PASSWORD
end
write memory
```

Verifica desde el servidor: `ssh -p 830 -s admin@192.168.1.254 netconf` debe devolver un `<hello>`.

## Instalación de la dependencia SSH

`node-ssh` es un **import perezoso** (no está en `package.json`); instálalo en el servidor:

```bash
cd apps/agent && pnpm add node-ssh
```

## Variables de entorno

```env
DRIVER_KIND=cisco-netconf
CISCO_NETCONF_HOST=192.168.1.254     # por defecto DRIVER_HOST
CISCO_NETCONF_PORT=830
CISCO_NETCONF_USER=admin             # por defecto CISCO_USER
CISCO_NETCONF_PASSWORD=              # por defecto CISCO_PASSWORD
CISCO_INTERFACE=GigabitEthernet1     # interfaz WAN para métricas de tráfico
```

## Qué hace el driver

| Capacidad | Modelo YANG / operación | Notas |
|---|---|---|
| Descubrimiento | `<get>` `Cisco-IOS-XE-arp-oper` | IP+MAC (normaliza a `xx:xx:xx:xx:xx:xx`). |
| Tráfico WAN | `<get>` `Cisco-IOS-XE-interfaces-oper` | `in-octets`/`out-octets` → tasa por delta. |
| Bloqueo | `<edit-config>` ACL MAC `Cisco-IOS-XE-acl` | Regla `deny` por MAC; `operation="delete"` para desbloquear. |

**No soportado:** WiFi (lanza, como `cisco-ios`) y `scanMdns` (vacío).

## IOS vs IOS-XE (resumen)

- `cisco-ios` (US-37): cualquier IOS por SSH+CLI. Default para hardware antiguo.
- `cisco-netconf` (US-39): IOS-XE 16.6+ por NETCONF/YANG. Más limpio y transaccional.

Ambos comparten el contrato `HardwareDriver` y los parsers de MAC; difieren solo en el transporte
y el formato de las respuestas. El parseo XML es propio (sin dependencias externas).
