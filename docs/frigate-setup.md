# Conectar Frigate (NVR con detección de objetos) — US-214

**Frigate** ([frigate.video](https://frigate.video)) es el NVR delegado de KrakenOS (ver
`docs/adr-positioning.md`): detección de objetos por ML (persona/coche/gato…), pre-roll y
grabación continua viven allí, y KrakenOS **no los reimplementa** — se conecta a un Frigate
existente y hereda su detección. El detector propio (diferencia de grises 32×24, US-186) queda
como básico integrado para instalaciones sin Frigate.

## Qué obtienes al conectarlo

- Las **cámaras de Frigate** aparecen en `/cameras` (lista, snapshot y vídeo en vivo).
- Los **avisos llegan con el objeto detectado** («persona en Entrada»), y el builder de
  automatizaciones gana el **filtro por objeto**: «si detecta **persona** en la Entrada → …».
- Las **grabaciones de Frigate** se listan y descargan desde el timeline de cada cámara.
- Todo se sirve **por proxy autenticado**: la URL de Frigate/go2rtc **nunca** llega al navegador,
  y el vídeo en vivo usa el mismo modelo de token efímero que las cámaras RTSP (US-185).

## Qué NO hace KrakenOS con Frigate (honesto)

- **No detecta por su cuenta**: con Frigate conectado, el frame-diff local se apaga solo (la
  detección no se duplica). Los ajustes de aviso por cámara (activado, armado por horario,
  cooldown) siguen gobernando **los avisos**.
- **No graba clips locales** ni gestiona la retención: los clips viven en Frigate y su retención
  se configura allí. Borrar desde KrakenOS responde 400 con el motivo.
- **No configura Frigate**: cámaras, zonas y detección se administran en la UI de Frigate.

## Configuración

**Desde la app (recomendado):** Conectar → Cámaras → **Frigate** → pega la URL y guarda.

**Por variable de entorno:**

```bash
CAMERAS_KIND=frigate
FRIGATE_URL=http://192.168.1.30:5000
# FRIGATE_GO2RTC_URL=http://192.168.1.30:1984   # solo si cambiaste el puerto de go2rtc
```

La URL pasa por la **política de egress** (LAN sí; metadata de nube, jamás). El vídeo en vivo se
proxya del **go2rtc** embebido en Frigate (puerto 1984 por defecto).

## Verificación con un Frigate real (checklist US-86)

1. Conectar → las cámaras de Frigate aparecen en `/cameras` con snapshot.
2. «Ver en vivo» reproduce (el navegador solo habla con KrakenOS; verificar en las herramientas
   de red que no hay peticiones a la IP de Frigate).
3. Activar el aviso de movimiento en una cámara → pasar por delante → aviso con «(person)».
4. Crear la automatización «si detecta persona → enciende luz» → verificar que un coche NO la
   dispara.
5. Timeline: los clips de Frigate se listan y descargan; borrar responde el aviso honesto.
