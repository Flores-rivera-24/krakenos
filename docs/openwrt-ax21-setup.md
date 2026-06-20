# Activar el driver OpenWrt en el TP-Link Archer AX21

El código del driver `openwrt` ya existe en KrakenOS (US-22): habla con el router por
**SSH + UCI** contra un transporte inyectable. No hay nada que programar — solo hay que
**instalar OpenWrt** en el Archer AX21 y **configurar el `.env`** del agente.

> El Archer AX21 (AX1800) viene de fábrica con el firmware de TP-Link, que **no expone una
> API gestionable**. OpenWrt lo convierte en un router con SSH/UCI, que es lo que el driver
> `openwrt` necesita.

---

## 0. Antes de empezar

- **Comprueba la revisión de hardware** del router. La etiqueta inferior indica `Ver: 1.0`,
  `Ver: 3.0`, etc. OpenWrt soporta el Archer AX21 (AX23) desde **OpenWrt 23.05**; las
  revisiones **v1.x y v3.x** están soportadas (la v4+ puede no estarlo aún — verifícalo).
- **Riesgo**: flashear firmware de terceros puede inutilizar el router (brick) y anula la
  garantía. Hazlo con calma y con el `.bin` correcto **para tu revisión exacta**.
- Ten a mano un cable Ethernet (haz el flasheo por cable, nunca por WiFi).

## 1. Descargar el firmware correcto

Usa el **selector oficial de firmware** de OpenWrt (te da el `.bin` exacto para tu modelo y
revisión, sin adivinar URLs):

1. Abre <https://firmware-selector.openwrt.org/>.
2. Busca **`Archer AX21`** y selecciona tu revisión (`v1`, `v3`, …).
3. Descarga la imagen **`factory`** (`...-squashfs-factory.bin`): es la que acepta el
   firmware de stock de TP-Link para el primer flasheo.
   - La imagen **`sysupgrade`** (`...-squashfs-sysupgrade.bin`) se usa para actualizar
     **desde** OpenWrt, no para el primer salto desde el firmware de TP-Link.
4. (Recomendado) Verifica el `sha256` que muestra el selector contra el del fichero descargado.

Página de referencia del modelo (Table of Hardware):
<https://openwrt.org/toh/tp-link/archer_ax21>

## 2. Flashear desde el firmware de stock de TP-Link

1. Conecta tu PC por cable a un puerto LAN del router.
2. Entra a la interfaz web de TP-Link: **`http://192.168.0.1`** (o `http://tplinkwifi.net`).
3. Ve a **Advanced → System Tools → Firmware Upgrade** (o **System → Firmware Update**,
   según versión) → **Manual Upgrade / Local Upgrade**.
4. Sube el **`...factory.bin`** descargado y confirma. El router se reinicia en OpenWrt
   (2-3 minutos). **No desconectes la corriente** durante el proceso.

> Si algo sale mal, el AX21 tiene **recuperación TFTP** (mantener Reset al encender). Consulta
> la sección de recovery en la página del modelo antes de empezar, por si acaso.

## 3. Primer arranque de OpenWrt y SSH

Tras flashear, OpenWrt escucha en **`192.168.1.1`** (¡cambia respecto al `192.168.0.1` de
TP-Link!).

1. Renueva la IP de tu PC (DHCP) o ponte en la subred `192.168.1.0/24`.
2. Abre **`http://192.168.1.1`** (LuCI, la web de OpenWrt) **o** entra por SSH:

   ```bash
   ssh root@192.168.1.1
   ```

   La **primera vez no hay contraseña** (login directo como `root`).
3. **Pon una contraseña** de root (también habilita el login SSH por password):

   ```sh
   passwd
   ```

4. **Habilita la WiFi** (de fábrica viene apagada en OpenWrt). Mira las radios disponibles:

   ```sh
   uci show wireless
   ```

   En el AX21 suelen aparecer `radio0` (5 GHz) y `radio1` (2.4 GHz). Para encender una red:

   ```sh
   uci set wireless.radio0.disabled='0'
   uci set wireless.default_radio0.ssid='MiRedKraken'
   uci set wireless.default_radio0.encryption='psk2'
   uci set wireless.default_radio0.key='una-contraseña-fuerte'
   uci commit wireless
   wifi reload
   ```

   (También puedes hacerlo desde LuCI → Network → Wireless.)

## 4. Verificar SSH antes de activar el driver

Desde el servidor donde corre el agente KrakenOS:

```bash
ssh root@192.168.1.1 'cat /proc/net/arp; echo OK'
```

Si ves la tabla ARP y `OK`, el driver podrá descubrir dispositivos. Si SSH pide aceptar la
huella del host, acéptala una vez.

## 5. Instalar la dependencia SSH del agente

El driver carga `node-ssh` con **import perezoso** (no está en `package.json` para no romper
el lockfile de CI). Instálalo en el servidor:

```bash
cd apps/agent
pnpm add node-ssh
```

## 6. Configurar el `.env`

Copia las variables de **`apps/agent/.env.openwrt.example`** a tu `.env`. Las claves que lee
el agente (ver `apps/agent/src/config/env.ts`) son:

| Variable | Para qué | Default |
|---|---|---|
| `DRIVER_KIND` | Selecciona el driver | `mock` → ponlo en `openwrt` |
| `DRIVER_HOST` | IP/host del router | — (p. ej. `192.168.1.1`) |
| `OPENWRT_SSH_PORT` | Puerto SSH | `22` |
| `OPENWRT_SSH_USER` | Usuario SSH | `root` |
| `OPENWRT_SSH_PASSWORD` | Contraseña SSH (o usa clave) | — |
| `OPENWRT_SSH_KEY_PATH` | Ruta a una clave privada SSH (alternativa al password) | — |
| `OPENWRT_WAN_IFACE` | Interfaz WAN para el tráfico | `wan` |
| `OPENWRT_GUEST_NETWORK` | Red de invitados (UCI) | `guest` |

> **Nota de seguridad**: lo ideal es usar **clave SSH** (`OPENWRT_SSH_KEY_PATH`) en vez de
> contraseña. Si usas contraseña, mantén el `.env` fuera de git (ya está en `.gitignore`).

## 7. Probar

```bash
pnpm dev            # agente :3001 · web :5173
```

- **Inventario** (`/inventory`): deben aparecer los dispositivos reales de la LAN (ARP + leases).
- **Bloquear** un dispositivo desde el modal → se aplica una regla iptables de MAC en el router.
- **WiFi** (`/wifi`): cambiar el SSID debe reflejarse en el router (`uci show wireless`).

Si algo falla, revisa los logs del agente (errores de SSH/UCI) y confirma que el usuario SSH
tiene permisos para `uci`/`iptables` en el router (root los tiene).
