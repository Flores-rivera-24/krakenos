# Acceso remoto — árbol de decisión

KrakenOS nunca expone la UI a internet: desde fuera de casa se entra por un **túnel**. Hay dos
vías, y cuál te toca depende de una sola pregunta: **¿tu conexión tiene IP pública?**

> Compruébalo rápido: si la IP WAN que reporta tu router coincide con la que ves en
> «cuál es mi IP» desde un navegador de casa, tienes IP pública. Si no coincide (o tu
> operador es 5G/fibra compartida), estás tras **CGNAT** y no puedes abrir puertos.

| | WireGuard propio (integrado) | Tailscale (detección) |
|---|---|---|
| Requiere IP pública | **Sí** (+ abrir el puerto UDP en el router) | No — atraviesa CGNAT |
| Quién lo gestiona | KrakenOS (peers con QR desde `/vpn`) | Tú, con la cuenta de Tailscale (gratis hasta 3 usuarios) |
| Dependencias de terceros | Ninguna (100% tuyo) | Coordinación de Tailscale (el tráfico va cifrado extremo a extremo; sus servidores solo coordinan) |
| Si el servicio externo cae | Nada que caer | Los túneles ya establecidos suelen sobrevivir; no se levantan nuevos hasta que vuelva |
| Estado en KrakenOS | Página `/vpn` completa | Card de estado (activo / falta sesión / sin responder / no detectado) + guía |

**Regla simple:** con IP pública, usa el WireGuard propio (cero terceros). Tras CGNAT, instala
Tailscale en el servidor — KrakenOS lo detecta y te muestra el nombre MagicDNS listo para usar.
KrakenOS **no administra** el tailnet (iniciar sesión es interactivo): detecta, guía y muestra.

## Puesta en marcha de Tailscale (CGNAT)

1. En el servidor: `curl -fsSL https://tailscale.com/install.sh | sh` y luego `sudo tailscale up`
   (abre una URL de login; inicia sesión una vez).
2. En el teléfono/portátil: instala la app de Tailscale e inicia sesión con la misma cuenta.
3. La card de **VPN / Acceso remoto** mostrará el **nombre MagicDNS** del servidor
   (p. ej. `krakenos.tail1234.ts.net`): entra a la app usándolo como host, con el mismo
   puerto de siempre.

> El agente consulta el socket local de `tailscaled` (`TAILSCALE_SOCKET`, por defecto
> `/var/run/tailscale/tailscaled.sock`). Es una consulta **local**: nada sale a la red.

## HTTPS con un certificado en el que tu móvil confía

**Es un prerrequisito, no un extra.** Sobre HTTP el navegador no considera el origen «seguro» y
se caen tres cosas que la app ya trae: la **PWA instalable**, los **avisos push** y las
**passkeys**. Con Tailscale ya montado, resolverlo son dos minutos:

```bash
# En el servidor, una vez montado Tailscale (arriba)
sudo /opt/krakenos/scripts/install.sh --tls tailscale
```

Eso emite un certificado de **Let's Encrypt** para tu nombre `*.ts.net` —en el que cualquier
móvil confía **sin instalar nada**—, lo apunta en el `.env` y programa un timer semanal que lo
renueva. El agente **detecta el fichero renovado y lo aplica en caliente**, sin reiniciar el
servicio ni cortar sesiones.

Tres cosas que conviene saber antes:

- **Hay que activarlo en el tailnet.** En la consola de Tailscale: *DNS → MagicDNS* y
  *HTTPS Certificates*. Sin eso, `tailscale cert` no emite nada.
- **El nombre queda público.** Todo certificado de Let's Encrypt se publica en los registros de
  **Certificate Transparency**, que son públicos y permanentes: cualquiera puede descubrir que
  existe `tu-maquina.tailnet-abc.ts.net`. No revela tu IP, ni tus datos, ni da acceso — pero es
  un nombre menos privado que antes, y se dice.
- **Dura 90 días.** Con el timer instalado se renueva solo. Si lo montas a mano, KrakenOS avisa
  en Ajustes → Sistema **21 días antes** y por el canal de alertas que tengas configurado.

¿Sin Tailscale? `--tls self` genera un autofirmado: cifra el tráfico, pero **cada dispositivo**
avisará de «sitio no seguro» hasta que instales la CA en él, y algunos navegadores siguen
negando las passkeys. Es la opción de último recurso, no la recomendada.

## Tu móvil en 3 pasos (cualquiera de las dos vías)

1. **Instala la app (PWA).** Abre KrakenOS en el navegador del teléfono y añádela a la
   pantalla de inicio (Android: menú de Chrome → «Añadir a pantalla de inicio»; iPhone:
   Compartir → «Añadir a pantalla de inicio»). En iPhone, las notificaciones push **solo**
   llegan con la app instalada (requisito de iOS 16.4+).
2. **Túnel automático.** WireGuard: activa «On-Demand» (iPhone: al salir de tu WiFi) o
   «VPN siempre activa» (Android). Tailscale: deja su app conectada. Así el túnel se
   levanta solo al salir de casa y abrir el icono siempre funciona.
3. **Una sola dirección.** La PWA queda **atada a su URL**: usa un nombre (no la IP) que
   resuelva igual en casa y por el túnel. Con WireGuard propio: un registro local en el
   Pi-hole que reparte la VPN (`WG_DNS`), p. ej. `krakenos.lan` — es el escenario A de
   [`webauthn-setup.md`](webauthn-setup.md). Con Tailscale: el propio nombre MagicDNS.

La sesión se mantiene sola: el refresh token vive en una cookie de 30 días que se renueva con
el uso, así que abrir la app entra directa al dashboard mientras la uses al menos una vez al mes.

## Nota WebAuthn (passkeys)

Las passkeys exigen HTTPS + un **hostname estable** como `WEBAUTHN_RP_ID` (nunca una IP). Si
entras por Tailscale, usa el nombre MagicDNS como RP_ID y en `WEBAUTHN_ORIGIN`; si usas el
hostname del Pi-hole, ese. Detalle completo en [`webauthn-setup.md`](webauthn-setup.md).

## Qué pasa si algo se cae

- **Se cae tu internet:** ninguna vía funciona desde fuera (obvio), pero la LAN sigue.
- **Se cae el WireGuard propio:** revisa el servicio y el puerto UDP; nadie más está implicado.
- **Se cae la coordinación de Tailscale:** los túneles vivos suelen mantenerse; los nuevos
  esperan. Si el acceso remoto es crítico y tienes IP pública, el WireGuard propio elimina
  esa dependencia.
