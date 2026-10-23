# Documentación de KrakenOS

Índice de `docs/`. El [README raíz](../README.md) es la puerta de entrada (qué es, arranque,
instalación); aquí está el detalle.

## Instalación y operación

| Documento | Para qué |
|---|---|
| [updates.md](updates.md) | comprobación de versión, actualización one-click con rollback |
| [recovery.md](recovery.md) | recuperación ante desastres: copias, restauración, admin perdido |
| [remote-access.md](remote-access.md) | WireGuard propio vs. Tailscale, y HTTPS de confianza |
| [webauthn-setup.md](webauthn-setup.md) | passkeys como segundo factor |
| [jwt-key-rotation.md](jwt-key-rotation.md) | rotación de las claves RS256 |
| [docker-limitations.md](docker-limitations.md) | qué no funciona dentro del contenedor |
| [app-escritorio.md](app-escritorio.md) | abrir KrakenOS como app de escritorio (PWA) |
| [launch-checklist.md](launch-checklist.md) | checklist antes de dárselo a primeros usuarios |

## Drivers de red (`DRIVER_KIND`)

| Documento | Hardware |
|---|---|
| [openwrt-ax21-setup.md](openwrt-ax21-setup.md) | OpenWrt (probado en TP-Link Archer AX21) |
| [pfsense-setup.md](pfsense-setup.md) | pfSense (REST API v2) |
| [unifi-setup.md](unifi-setup.md) | Ubiquiti UniFi Network |
| [mikrotik-setup.md](mikrotik-setup.md) | MikroTik RouterOS 7 |
| [omada-setup.md](omada-setup.md) | TP-Link Omada Controller |
| [asus-setup.md](asus-setup.md) | ASUS / Asuswrt-Merlin |

## IoT (`IOT_KIND`)

| Documento | Ecosistema |
|---|---|
| [mqtt-discovery-setup.md](mqtt-discovery-setup.md) | MQTT Discovery (ESPHome, Tasmota, OpenBeken, Z-Wave JS UI…) |
| [zigbee2mqtt-setup.md](zigbee2mqtt-setup.md) | Zigbee vía zigbee2mqtt |
| [matter-setup.md](matter-setup.md) | Matter como controlador (python-matter-server) |
| [hue-setup.md](hue-setup.md) | Philips Hue |
| [govee-setup.md](govee-setup.md) | Govee (API LAN) |
| [tuya-setup.md](tuya-setup.md) | Tuya local |
| [kasa-tapo-setup.md](kasa-tapo-setup.md) | TP-Link Kasa / Tapo |
| [shelly-setup.md](shelly-setup.md) | Shelly Gen1 / Gen2 |
| [meross-setup.md](meross-setup.md) | Meross (MQTT local) |
| [composite-iot-setup.md](composite-iot-setup.md) | varios backends a la vez |

## Servicios de red, cámaras y avisos

| Documento | Qué |
|---|---|
| [wireguard-firewall-qos-setup.md](wireguard-firewall-qos-setup.md) | VPN WireGuard, firewall iptables y QoS tc (helper privilegiado) |
| [pihole-setup.md](pihole-setup.md) | DNS / bloqueo con Pi-hole v6 |
| [vlan-switch-setup.md](vlan-switch-setup.md) | VLANs en un switch gestionado por SNMP |
| [rtsp-cameras-setup.md](rtsp-cameras-setup.md) | cámaras RTSP con ffmpeg (vivo, movimiento, clips) |
| [frigate-setup.md](frigate-setup.md) | Frigate como NVR delegado |
| [alerts-setup.md](alerts-setup.md) | alertas por push, email y Telegram |

## Interoperabilidad

| Documento | Qué |
|---|---|
| [interop.md](interop.md) | tokens de API y MQTT saliente hacia Home Assistant / Node-RED |
| [matter-bridge-setup.md](matter-bridge-setup.md) | puente Matter hacia Alexa / Google / Apple |
| [presence.md](presence.md) | presencia por WiFi: límites y mitigaciones |
| [coverage-notes.md](coverage-notes.md) | qué puede y qué no puede decir el mapa de cobertura |

## Desarrollo y calidad

| Documento | Qué |
|---|---|
| [qa.md](qa.md) | qué se prueba, con qué herramienta y qué número es honesto |
| [e2e.md](e2e.md) · [e2e-stacks.md](e2e-stacks.md) | suite Playwright y verificación de `pnpm dev`/`pnpm prod` |
| [design-system.md](design-system.md) | tokens, utilidades de Tailwind 4 y componentes |
| [copy-style.md](copy-style.md) | cómo se escriben los textos de la interfaz |
| [accessibility.md](accessibility.md) | compromisos y pruebas de accesibilidad |
| [threat-model.md](threat-model.md) | modelo de amenazas y auditoría de seguridad |

## Decisiones de arquitectura (ADR)

| ADR | Decisión |
|---|---|
| [adr-positioning.md](adr-positioning.md) | «el cerebro de red del hogar», complemento de Home Assistant |
| [adr-licencia.md](adr-licencia.md) | AGPL-3.0-or-later |
| [adr-distribution.md](adr-distribution.md) | modelo de distribución y canal de updates |
| [adr-instalable.md](adr-instalable.md) | instalable en Windows y Linux desde un ejecutable |
| [adr-app-escritorio.md](adr-app-escritorio.md) | KrakenOS como app de escritorio |
| [adr-voice.md](adr-voice.md) | voz por puente Matter, no skill de nube |
| [adr-matter-certification.md](adr-matter-certification.md) | el muro de la certificación Matter |
| [adr-ingesta-mqtt.md](adr-ingesta-mqtt.md) | consumir MQTT Discovery, no Home Assistant |
| [adr-cerraduras.md](adr-cerraduras.md) | cerraduras: leer y cerrar, no abrir |
| [adr-control-total.md](adr-control-total.md) | control total frente a la app del fabricante |
