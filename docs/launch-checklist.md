# Checklist de lanzamiento a primeros usuarios

Objetivo: **10 usuarios reales** y un canal de feedback con mínima fricción. 10 usuarios enseñan
más que 50 historias nuevas — a partir de aquí, el backlog lo ordena la realidad.

## Antes de publicar (una vez)

- [ ] **Activar Discussions** en el repo de GitHub (Settings → General → Features → Discussions).
      _(Ajuste de la UI de GitHub; lo hace el dueño del repo — las plantillas de issue ya están
      en `.github/ISSUE_TEMPLATE/`.)_
- [ ] Crear al menos **una release etiquetada** (`v0.1.0`): el instalador instala la
      última etiqueta `v*` y el update-check compara contra releases.
- [ ] Pasada real del **checklist de hardware** en tu propia casa: cada `verified:true`
      que puedas afirmar en el post vale oro; lo que no esté verificado se dice tal cual.
- [ ] Releer `README.md` con ojos de recién llegado: el quickstart es un comando, «Qué NO es»
      está arriba, y ninguna promesa supera lo verificado.

## Criterios de éxito (medibles, 4–6 semanas)

- **10 instalaciones reales** (personas que llegan al wizard `/setup` en su hardware).
- **5 informes de hardware verificado** (plantilla `hardware-report.yml` → el catálogo de compatibilidad pasa
  `verified:false → true` con evidencia comunitaria).
- **Todo issue respondido en <48 h** (compromiso de respuesta; ver abajo).
- Señales del ADR de distribución recogidas: ¿instalan?, ¿actualizan?, ¿CGNAT?

## Compromiso de respuesta

- Issues: primera respuesta en **48 h** (aunque sea «recibido, lo miro el finde»).
- Un bug con paquete de soporte adjunto tiene prioridad sobre cualquier feature.
- Cada informe de hardware se agradece y se refleja en el catálogo en la siguiente release.

## Borrador del post — r/selfhosted (inglés)

> **KrakenOS — a local-first "network brain" for your home (WiFi heatmaps on your floor plan, real parental controls, presence without cloud geofencing)**
>
> I've been building KrakenOS: a self-hosted home network + IoT manager that runs on a Pi/mini
> PC. It's **not** another Home Assistant — it's a **companion**: it does the network things HA
> doesn't, and publishes everything to HA via MQTT Discovery.
>
> What's actually unique: WiFi coverage heatmaps **on your real floor plan** (import it from a
> photo/PDF, assisted wall detection), per-device parental controls at the **network** level
> (schedules, one-tap internet pause), WiFi presence detection without cloud geofencing, per-person
> internet usage with role-based privacy, and the usual network stack (inventory, WireGuard VPN
> with QR, VLANs, QoS, Pi-hole integration) behind one UI.
>
> Honest limits: the built-in camera motion detection is basic — for real cameras it connects to
> **Frigate** and inherits its object detection. Voice goes through a local **Matter bridge** (your
> assistant will warn "uncertified device" — explained in the docs). The alarm mode is not a
> certified alarm. Docker image exists but it's demo-only (no VPN/firewall/QoS from a container);
> the real install is one command on Debian/Ubuntu/Pi.
>
> Install: `curl -fsSL https://raw.githubusercontent.com/Flores-rivera-24/krakenos/main/scripts/install.sh | sudo bash`
>
> I'm looking for the first 10 real installs. If you try it, the app has a "send feedback" button
> that pre-fills a GitHub issue (nothing is sent automatically — it's local-first to a fault).
> Hardware reports are especially welcome: the compatibility catalog distinguishes
> "supported-by-code" from "verified-on-hardware", and only community reports move things to
> verified.

## Borrador del post — r/homeassistant (inglés)

> **KrakenOS: a network-side companion for HA (WiFi heatmaps, parental controls, presence) that shows up via MQTT Discovery**
>
> Not an HA replacement — it doesn't want to be. KrakenOS runs next to HA and covers the network
> side: WiFi coverage heatmaps on your actual floor plan, per-device internet schedules/pause
> (network-level parental controls), WiFi presence without cloud geofencing, per-person usage, and
> a full network stack (inventory/VPN/VLAN/QoS/DNS).
>
> The HA integration is native MQTT Discovery. Besides lights, plugs, energy, home mode and alarm
> state, it exposes **the things HA doesn't have natively** — which is the actual reason to run it
> alongside HA:
>
> - a `binary_sensor` per device: **"internet blocked"**, derived from all three sources (manual
>   block, schedule, one-tap pause), with the reason in its attributes;
> - a `sensor` per room: the **worst WiFi signal** among the devices connected in that room (dBm,
>   measured by the AP — a room with nothing connected reports *unavailable*, never a made-up value);
> - a `button` per device: **"pause internet 30 min"**.
>
> State publishing, IoT control and internet-pausing are **three separate opt-ins**, all off by
> default — letting HA toggle a lamp and letting it cut someone off are not the same permission, and
> an MQTT broker has no notion of *who* is asking. Every pause coming in this way is audited.
>
> Honest about what is **not** there: home mode only, **never the list of people** (privacy rule);
> no per-person internet usage yet (the routers KrakenOS supports don't report per-device traffic, so
> that sensor would publish zero forever — it ships when the data is real); and the coverage heatmap
> stays out of HA because it's a *predicted model*, not a measurement.
>
> If the agent dies, HA finds out: everything hangs off an availability topic backed by an MQTT
> **LWT**, so the broker marks the house unavailable on our behalf.
>
> If you run Frigate: KrakenOS connects to it for cameras and inherits object detection labels in
> its automations ("if a *person* is detected at the entrance → …").

## Borrador del post — foro OpenWrt (inglés)

> **KrakenOS — self-hosted network manager with first-class OpenWrt support (SSH+UCI driver)**
>
> KrakenOS manages your home network through your OpenWrt router: real-time inventory (ARP+DHCP),
> device blocking, per-device schedules, WiFi management (SSID/password/guest), traffic stats —
> plus WiFi coverage heatmaps drawn on your floor plan. The OpenWrt driver talks SSH+UCI; setup
> guide included (tested path: Archer AX21 on 23.05). Honest note: hardware marked
> "verified" in the compatibility catalog only after real-device reports — that's where you come in.

## Dónde NO publicar todavía

- Hacker News / Product Hunt: guardarlos para cuando haya 10 instalaciones y el catálogo tenga
  verificaciones reales — solo hay un estreno.

> La publicación la hace el dueño del proyecto (no es código). Este doc es el guion.
