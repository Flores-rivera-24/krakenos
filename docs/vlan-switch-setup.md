# VLANs en un switch gestionado (SNMP, Q-BRIDGE-MIB)

`VLAN_KIND=switch` aplica las VLANs que creas en `/vlans` a un **switch gestionado** por
**SNMPv2c**, sobre la tabla estándar `dot1qVlanStaticTable` de la **Q-BRIDGE-MIB**
(`apps/agent/src/vlan/switch.vlan.ts`, `q-bridge.ts`).

| Acción en KrakenOS | SET SNMP |
|---|---|
| Crear VLAN | `dot1qVlanStaticRowStatus.<tag>` = createAndGo + `dot1qVlanStaticName.<tag>` |
| Renombrar | `dot1qVlanStaticName.<tag>` |
| Borrar | `dot1qVlanStaticRowStatus.<tag>` = destroy |

Si el switch rechaza el SET, el error se muestra y **no se guarda nada** en KrakenOS.

> **Lo que no hace:** no asigna **puertos** a la VLAN (tagged/untagged) ni configura el router.
> La subred y el «aislamiento» que guardas en KrakenOS son metadatos para la UI y el firewall; el
> switch solo recibe la VLAN 802.1Q y su nombre. La pertenencia de puertos se hace en el switch.

---

## 1. Requisitos

- Un switch gestionado que soporte **escritura SNMPv2c** sobre la Q-BRIDGE-MIB (la mayoría de
  TP-Link JetStream, Netgear smart/managed, HP/Aruba, Cisco SG… lo hacen; muchos *easy smart* no).
- La dep opcional **`net-snmp`** en el servidor (`install.sh --with-deps`, o
  `cd apps/agent && pnpm add net-snmp`).

## 2. En el switch

1. Activa **SNMP v2c**.
2. Crea una **community de escritura** (no uses `private`: elige una cadena larga) y, si el switch
   lo permite, restríngela a la IP del servidor de KrakenOS.
3. Comprueba desde el servidor:

   ```bash
   snmpwalk -v2c -c <community> 192.168.1.2 1.3.6.1.2.1.17.7.1.4.3.1.1
   ```

   Debe listar los nombres de las VLANs existentes.

## 3. Configurar KrakenOS

```env
VLAN_KIND=switch
VLAN_SWITCH_HOST=192.168.1.2
VLAN_SWITCH_COMMUNITY=<community-de-escritura>
VLAN_SWITCH_SNMP_PORT=161
VLAN_STORE=data/vlans.json      # metadatos (subred, aislamiento): fuente de verdad local
```

## Seguridad

SNMPv2c viaja **en claro**: la community se puede leer en la LAN. Mantén la gestión del switch en
una VLAN de administración y limita la community a la IP del servidor.
