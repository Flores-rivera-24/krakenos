# Activar la integración Meross

La integración `meross` (US-71) controla enchufes e interruptores Meross (MSS110, MSS210,
MSS310, regletas MSS425…) **sin la app ni la nube de Meross**, hablando con ellos a través de un
**broker MQTT local**. Requiere el paquete `mqtt` en el servidor (import perezoso, igual que
zigbee2mqtt).

> Los dispositivos Meross se conectan por MQTT a `iot.meross.com`. Para control local hay que
> **redirigir ese DNS** a un **Mosquitto local** y dar a cada dispositivo su `key` (de la cuenta
> Meross). No hay discovery en esta versión: se configuran a mano.

---

## 1. Instalar el broker y la dependencia

```bash
# En el servidor:
sudo apt install mosquitto
pnpm add mqtt        # dependencia opcional del agente (no va en package.json)
```

Configura Mosquitto para escuchar en `1883` en tu LAN (y, si quieres, TLS en `8883`).

## 2. Redirigir el DNS de Meross

Los dispositivos se conectan a `iot.meross.com`. Redirige ese nombre a la IP de tu Mosquitto:

- En **Pi-hole / dnsmasq**: `address=/iot.meross.com/192.168.1.5`.
- O en tu router: una entrada DNS local `iot.meross.com → 192.168.1.5`.

Reinicia (apaga/enciende) cada Meross para que reconecte al broker local.

## 3. Obtener el `key` de cada dispositivo

Cada Meross firma sus mensajes MQTT con una **key** ligada a tu cuenta Meross. Se obtiene una vez
(p. ej. con `meross_lib`/`meross-cli` apuntando a la API de Meross con tu usuario y contraseña, o
capturando el primer handshake). Anota el `uuid` y el `key` de cada dispositivo.

> El `key` se guarda solo en el `.env` del servidor; el control es 100% local una vez configurado.

## 4. Configurar el `.env` del agente

```bash
IOT_KIND=meross
MEROSS_BROKER_HOST=192.168.1.5
MEROSS_BROKER_PORT=1883
MEROSS_DEVICES=[{"uuid":"2012...","name":"Enchufe TV","channels":1,"key":"abcd..."}]
```

- `channels`: nº de salidas (una regleta MSS425 → varias). Cada canal es un device
  (`meross:<uuid>:<channel>`).
- Se combina con otras integraciones: `IOT_KIND=hue,meross`.

Reinicia el agente; los dispositivos aparecen en `/iot`.

## 5. Cómo funciona

- El agente se suscribe a `m/v1/+/publish` y mantiene una caché de estado.
- Para encender/apagar publica un `Appliance.Control.ToggleX` firmado en `m/v1/<uuid>/subscribe`.
- Para refrescar el estado pide `Appliance.System.All` y lee la respuesta del topic `publish`.

## 6. Modelos compatibles

- Enchufes: MSS110, MSS210, MSS310 (con medición), MSS550.
- Regletas multi-salida: MSS425/MSS425E/MSS425F (cada salida = un canal).
- Interruptores: MSS510, MSS550.

## 7. Verificación con hardware real

1. **Listar**: los dispositivos configurados aparecen en `/iot` (reachable cuando responden).
2. **Encender un enchufe**: conmuta y el estado se refleja.
3. **Canal correcto**: en una regleta, cada salida responde por su `channel`.

## Limitaciones conocidas

- **Sin discovery**: hay que listar `uuid`/`key` en `MEROSS_DEVICES`.
- Requiere **Mosquitto + redirección DNS**; sin eso los Meross siguen yendo a la nube.
- Esta versión cubre **on/off** (ToggleX); el consumo (MSS310) y las persianas (MSG100) no se
  exponen todavía.
