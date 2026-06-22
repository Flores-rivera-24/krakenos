# Activar la integración TP-Link Kasa / Tapo

La integración `kasa` (US-68) controla enchufes, interruptores y focos TP-Link **sin nube** y sin
la app TP-Link, hablando el protocolo **local** de cada dispositivo. Cubre dos subfamilias con
protocolos distintos:

| Subfamilia | Generación | Protocolo local | Ejemplos |
|---|---|---|---|
| **Kasa** | Gen 1/2 | TCP/UDP 9999, cifrado XOR autokey | HS103, HS200, KL130 |
| **Tapo** | Gen 3+ | KLAP (AES-256 + handshake), HTTP 80 | L510E, P115, L530E |

No hay dependencia npm nueva: usa la stdlib de Node (`net`/`dgram`/`http`/`crypto`) con import
perezoso. El id de cada dispositivo lleva el prefijo `kasa:` o `tapo:`.

---

## 1. Kasa (Gen 1/2)

Los Kasa hablan un protocolo local sencillo (JSON cifrado con XOR sobre el puerto 9999) y
responden a **broadcast UDP**, así que normalmente se **autodescubren** sin configurar nada.

- Recomendado: en la app Kasa, asigna **IP fija** (DHCP reservation) a cada dispositivo.
- Si el broadcast no llega (VLAN distinta), añade las IPs a mano:

```bash
KASA_DEVICES=[{"ip":"192.168.1.60","deviceType":"plug"}]
```

> Algunos firmwares Kasa recientes migran a KLAP (como Tapo). Si un Kasa no responde por XOR,
> configúralo como Tapo (credenciales + IP).

## 2. Tapo (Gen 3+)

Los Tapo usan **KLAP**: un handshake de 3 pasos con las **credenciales de tu cuenta TP-Link**
(las mismas de la app Tapo), todo **local** (la cuenta solo se usa para derivar las claves de
sesión; no se sale a internet). El descubrimiento por broadcast es limitado, así que se
**configuran las IPs manualmente**.

```bash
TAPO_EMAIL=tu-correo@ejemplo.com
TAPO_PASSWORD=********
TAPO_DEVICES=[{"ip":"192.168.1.61","deviceType":"bulb"}]
```

- Asigna **IP fija** a cada Tapo en tu router.
- Las credenciales se guardan solo en el `.env` del servidor.

## 3. Configurar el `.env` del agente

```bash
IOT_KIND=kasa
# Kasa (autodescubrimiento; IPs opcionales)
KASA_DEVICES=[{"ip":"192.168.1.60","deviceType":"plug"}]
# Tapo (credenciales + IPs)
TAPO_EMAIL=tu-correo@ejemplo.com
TAPO_PASSWORD=********
TAPO_DEVICES=[{"ip":"192.168.1.61","deviceType":"bulb"}]
```

Se combina con otras integraciones en lista: `IOT_KIND=hue,govee,kasa` (cada backend enruta por
prefijo de id). Reinicia el agente; los dispositivos aparecen en `/iot`.

## 4. Modelos compatibles

- **Kasa enchufes/interruptores**: HS100/HS103/HS105/HS110, HS200/HS210/HS220 (dimmer).
- **Kasa focos**: KL110/KL120/KL130/KL135 (color), KL50/KL60.
- **Tapo enchufes**: P100/P105/P110/P115 (P110/P115 reportan consumo).
- **Tapo focos**: L510E (blanco regulable), L530E/L630 (color), tiras L900/L920.

## 5. Verificación con hardware real

1. **Listar**: los dispositivos aparecen en `/iot` con su nombre (alias Kasa / nickname Tapo).
2. **Encender/apagar**: el relé/luz responde al instante.
3. **Brillo/color**: en focos regulables/RGB, el brillo y el color cambian.

## Limitaciones conocidas

- El **descubrimiento Tapo** por broadcast es poco fiable: usa `TAPO_DEVICES` con IPs fijas.
- KLAP exige las **credenciales de la cuenta TP-Link**; sin ellas los Tapo no se pueden controlar.
- El consumo eléctrico (P110/P115) no se expone todavía en el contrato `IotDevice` (solo on/off,
  brillo y color).
