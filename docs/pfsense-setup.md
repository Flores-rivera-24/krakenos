# Activar el driver pfSense (REST API v2)

El driver `pfsense` habla con **pfSense** a través de la **REST API v2** del paquete
*pfSense REST API* (`pfSense-pkg-RESTAPI`), sobre un cliente HTTP inyectable
(`apps/agent/src/drivers/pfsense.transport.ts`). Todo es local: el agente llama a la IP de tu
firewall, nunca a una nube.

Qué cubre:

| Función | Cómo lo hace | Endpoint |
|---|---|---|
| Inventario | tabla ARP + leases DHCP | `GET /api/v2/diagnostics/arp_table`, `GET /api/v2/services/dhcp_server/leases` |
| Tráfico WAN | contadores de la interfaz WAN | `GET /api/v2/status/interface` |
| Bloqueo | regla `block` por IP origen en la interfaz LAN | `POST /api/v2/firewall/rule` + `POST /api/v2/firewall/apply` |
| Prueba de conexión | versión del sistema | `GET /api/v2/system/version` |

> **pfSense no gestiona WiFi.** Las páginas de WiFi muestran un aviso claro: los puntos de acceso
> van aparte (si son UniFi u Omada, ese driver puede convivir solo con uno activo por instancia).

---

## 1. Instalar el paquete REST API en pfSense

El paquete no está en el gestor oficial: se instala desde la consola (o *Diagnostics → Command
Prompt*) siguiendo las instrucciones del proyecto `pfrest` para tu versión de pfSense. Tras
instalarlo aparece **System → REST API**.

## 2. Activar la autenticación por API key y crear una clave

1. **System → REST API → Settings**: en *Authentication Methods* marca **Key**.
2. **System → REST API → Keys → Add**: crea una clave para un usuario con privilegios sobre
   firewall, diagnóstico y DHCP (un usuario dedicado `krakenos` es lo recomendable).
3. Copia la clave: es tu `PFSENSE_API_KEY`. Viaja en la cabecera `X-API-Key`.

## 3. Configurar

**Desde la app (recomendado):** Conectar → *Tu red y router* → pfSense. La clave se guarda
cifrada.

**Por `.env`:**

```env
DRIVER_KIND=pfsense
DRIVER_HOST=192.168.1.1            # o PFSENSE_URL=https://192.168.1.1
PFSENSE_API_KEY=xxxxxxxxxxxxxxxx
PFSENSE_WAN_IFACE=wan              # nombre de la interfaz WAN en pfSense
PFSENSE_LAN_IFACE=lan              # interfaz donde se crean las reglas de bloqueo
```

Si solo das `DRIVER_HOST`, la URL es `https://DRIVER_HOST`.

## 4. Verificación con hardware real

1. **Inventario** (`/inventory`): aparecen los equipos de la tabla ARP, con hostname de los leases.
2. **Bloqueo**: bloquea un equipo → en *Firewall → Rules → LAN* aparece una regla `block` con la
   descripción `krakenos-block:<mac>`. Al desbloquear, la regla desaparece.
3. **Tráfico** (`/traffic`): la tasa WAN se calcula entre dos lecturas; la primera muestra 0.

## Limitaciones conocidas

- **Bloqueo por IP, no por MAC**: la IP se resuelve desde la ARP al bloquear. Si el equipo cambia
  de IP (lease nuevo), la regla deja de cubrirlo. Usa reservas DHCP para los equipos que bloquees.
- **Solo IPv4** (`ipprotocol: inet`).
- **Sin tráfico por dispositivo**: solo el agregado WAN.
- Desbloquear es *best-effort*: si falla, el error no rompe la UI; revisa la regla a mano.
