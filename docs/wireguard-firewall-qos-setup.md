# VPN WireGuard, firewall y QoS (helper privilegiado)

Las tres funciones operan sobre el **propio servidor** de KrakenOS con `wg`, `iptables` y `tc`. El
agente corre **sin root**: cada comando pasa por `krakenos-helper`
(`apps/agent/scripts/krakenos-helper.sh`), invocado con `sudo -n`, que solo deja pasar un
subconjunto de verbos y **solo sobre un ámbito fijo**:

| Herramienta | Verbos permitidos | Ámbito |
|---|---|---|
| `wg` | `show`, `set` | solo la interfaz `KRAKENOS_WG_IFACE` (def. `wg0`) |
| `wg-quick` | `save` | solo esa interfaz |
| `iptables` | `-N -F -A -D -C -L`, solo tabla `filter` | la cadena `KRAKENOS_FW_CHAIN` (def. `KRAKENOS`) y el salto `FORWARD -j KRAKENOS` |
| `tc` | `qdisc`, `class`, `filter` | solo `dev KRAKENOS_TC_IFACE` (def. `eth0`) |

Cualquier otra cosa sale con código 64. El ámbito **no** lo puede ampliar el agente (sudo descarta
su entorno): se fija en el script o en `/etc/krakenos/helper.conf` (root-owned).

> **No funcionan en Docker** (ver [`docker-limitations.md`](docker-limitations.md)). En una
> instalación bare-metal, la app declara en cada página si el equipo puede operarlas.

---

## 0. Instalar el helper

Con el instalador: `install.sh --with-helper` (instala `wireguard-tools`, `iptables`, `iproute2`,
el helper y la regla sudoers). A mano:

```bash
sudo apt-get install -y wireguard-tools iptables iproute2
sudo install -m 0755 apps/agent/scripts/krakenos-helper.sh /usr/local/bin/krakenos-helper
sudo install -m 0440 apps/agent/scripts/krakenos.sudoers.example /etc/sudoers.d/krakenos
sudo visudo -cf /etc/sudoers.d/krakenos      # sustituye `krakenos` por el usuario del servicio
```

Si usas valores no-default (`WG_INTERFACE`, `FW_CHAIN`, `TC_INTERFACE`), ponlos **también** en el
helper:

```bash
sudo mkdir -p /etc/krakenos
printf 'KRAKENOS_WG_IFACE=wg0\nKRAKENOS_FW_CHAIN=KRAKENOS\nKRAKENOS_TC_IFACE=enp1s0\n' \
  | sudo tee /etc/krakenos/helper.conf
sudo chmod 0644 /etc/krakenos/helper.conf
```

---

## 1. VPN WireGuard (`VPN_KIND=wireguard`)

KrakenOS **gestiona los peers** (alta con QR, baja, estado) sobre una interfaz WireGuard **que ya
existe**: no la crea ni toca el NAT. Esa parte se monta una vez.

### 1.1 Crear la interfaz del servidor

```bash
wg genkey | sudo tee /etc/wireguard/server.key | wg pubkey | sudo tee /etc/wireguard/server.pub
sudo chmod 600 /etc/wireguard/server.key
```

`/etc/wireguard/wg0.conf` (ajusta `eth0` a tu interfaz LAN/WAN):

```ini
[Interface]
Address = 10.8.0.1/24
ListenPort = 51820
PrivateKey = <contenido de server.key>
PostUp   = iptables -t nat -A POSTROUTING -s 10.8.0.0/24 -o eth0 -j MASQUERADE
PostDown = iptables -t nat -D POSTROUTING -s 10.8.0.0/24 -o eth0 -j MASQUERADE
```

```bash
echo 'net.ipv4.ip_forward=1' | sudo tee /etc/sysctl.d/99-krakenos-wg.conf && sudo sysctl --system
sudo systemctl enable --now wg-quick@wg0
```

Abre el **puerto UDP 51820** en el router hacia el servidor. Si estás tras CGNAT no hay puerto que
abrir: usa Tailscale ([`remote-access.md`](remote-access.md)).

### 1.2 Configurar KrakenOS

```env
VPN_KIND=wireguard
VPN_ENDPOINT=mi-casa.duckdns.org   # host público al que se conectarán los clientes
VPN_LISTEN_PORT=51820
WG_INTERFACE=wg0
WG_SUBNET=10.8.0.0/24
WG_DNS=10.8.0.1                    # DNS anunciado a los clientes
WG_PEER_STORE=data/wg-peers.json
# WG_SERVER_PUBLIC_KEY=            # opcional; si falta se lee con `wg show wg0 public-key`
```

Cada peer nuevo recibe la siguiente IP libre de `WG_SUBNET`; el agente hace `wg set` y luego
`wg-quick save` para que sobreviva a un reinicio. La clave privada del cliente solo se muestra una
vez (en el QR / fichero de descarga).

---

## 2. Firewall (`FIREWALL_KIND=iptables`)

Las reglas de `/firewall` se guardan en `FW_RULE_STORE` (fuente de verdad) y en cada cambio se
**reconstruye** la cadena `KRAKENOS` entera: se crea si falta, se vacía, se vuelve a llenar y se
enlaza desde `FORWARD`. Cada regla lleva el comentario `krakenos:<id>` (visible en
`sudo iptables -L KRAKENOS -n -v`).

```env
FIREWALL_KIND=iptables
FW_CHAIN=KRAKENOS
FW_RULE_STORE=data/firewall-rules.json
```

> **Ojo con el alcance:** la cadena cuelga de `FORWARD`, así que solo filtra **tráfico que
> atraviesa el servidor** (clientes de la VPN, o la LAN si el servidor hace de router). No filtra
> el tráfico entre equipos de la LAN que no pasa por él. Para bloquear internet a un equipo
> concreto de la LAN, usa el bloqueo del driver del router (`/inventory`).

Solo IPv4. Con protocolo `any` y puerto, se emiten dos reglas (tcp y udp).

---

## 3. QoS (`QOS_KIND=tc`)

Las reglas de `/qos` se aplican como una jerarquía **HTB** en `TC_INTERFACE`, reconstruida en cada
cambio: clase raíz con `TC_LINK_KBIT`, una clase hoja por regla (prioridad alta/normal/baja →
`prio` 1/4/7, con límite opcional) y un filtro `u32` por **IP destino**. El tráfico sin regla va a
la clase por defecto.

```env
QOS_KIND=tc
TC_INTERFACE=eth0            # interfaz de SALIDA hacia los equipos a moldear
TC_LINK_KBIT=100000          # capacidad real del enlace (p. ej. 100 Mbit = 100000)
TC_RULE_STORE=data/qos-rules.json
```

> **Limitaciones (baseline):** solo moldea el **egress** de una interfaz, solo objetivos con
> **IP/CIDR IPv4**, y solo afecta al tráfico que sale por ese servidor. Pon `TC_LINK_KBIT` un poco
> por debajo de tu velocidad real, o el buffer del módem se lleva la cola y el QoS no se nota.

---

## Diagnóstico

```bash
sudo -n /usr/local/bin/krakenos-helper wg show wg0          # ¿funciona sudo sin contraseña?
sudo iptables -L KRAKENOS -n -v --line-numbers
tc -s class show dev eth0
```

Un `krakenos-helper: no permitido: …` significa que el ámbito del helper no coincide con el `.env`.
