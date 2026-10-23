# Cámaras RTSP (integrado, con ffmpeg)

`CAMERAS_KIND=rtsp` es la vía **básica integrada** para cámaras IP: snapshot, **vídeo en vivo
(HLS)**, **detección de movimiento** con foto y aviso, y **grabación de clips**. Todo con `ffmpeg`
en el servidor; nada sale de la LAN.

> Para detección por **objetos** (persona/coche), pre-roll y grabación continua, usa
> [Frigate](frigate-setup.md) (`CAMERAS_KIND=frigate`). KrakenOS no pretende ser un NVR.

---

## 1. Requisitos

- **`ffmpeg`** en el servidor (`install.sh --with-ffmpeg`, o `sudo apt-get install ffmpeg`).
  No está en la imagen Docker.
- La **URL RTSP** de cada cámara. La mayoría la documenta en su app o manual; formatos típicos:

  | Marca | URL |
  |---|---|
  | TP-Link Tapo | `rtsp://usuario:clave@IP:554/stream1` (crea la «cuenta de cámara» en la app) |
  | Reolink | `rtsp://usuario:clave@IP:554/h264Preview_01_main` |
  | Hikvision | `rtsp://usuario:clave@IP:554/Streaming/Channels/101` |
  | Dahua / Amcrest | `rtsp://usuario:clave@IP:554/cam/realmonitor?channel=1&subtype=0` |

  Pruébala antes: `ffmpeg -rtsp_transport tcp -i 'rtsp://…' -frames:v 1 prueba.jpg`.

## 2. Dar de alta las cámaras

**Desde la app (recomendado):** Conectar → Cámaras → RTSP, y luego **Cámaras → Añadir**. El alta
se escribe en el fichero de config y se lee **en vivo**, sin reiniciar.

**A mano:** `CAMERAS_CONFIG` (por defecto `data/cameras.json`):

```json
[
  {
    "id": "entrada",
    "name": "Entrada",
    "room": "Recibidor",
    "model": "Tapo C200",
    "rtspUrl": "rtsp://camara:secreto@192.168.1.60:554/stream1",
    "enabled": true
  }
]
```

La `rtspUrl` lleva credenciales: **nunca** se devuelve por la API y el fichero vive en `data/`
(gitignored, permisos restringidos, incluido en las copias de seguridad cifradas).

## 3. Variables

```env
CAMERAS_KIND=rtsp
CAMERAS_CONFIG=data/cameras.json
CAMERAS_RTSP_TRANSPORT=tcp        # tcp (recomendado) o udp
CAMERAS_HLS_DIR=var/hls           # segmentos en vivo: efímeros, FUERA de data/
CAMERAS_MAX_STREAMS=2             # streams en vivo simultáneos (1–16)
CAMERAS_STREAM_IDLE_SEC=30        # se apaga el transcodificado si nadie mira
CAMERAS_RECORDINGS_DIR=data/recordings
# FFMPEG_PATH=ffmpeg              # solo por .env; la UI no lo expone a propósito
```

En una Raspberry Pi, deja `CAMERAS_MAX_STREAMS` en 1–2: cada stream es un proceso `ffmpeg`.

## Problemas típicos

- **Snapshot gris o error de timeout**: prueba `CAMERAS_RTSP_TRANSPORT=udp`, o la URL del
  *substream* (menos resolución, menos CPU).
- **El vivo tarda en arrancar**: es normal unos segundos (primer segmento HLS).
- **Movimiento demasiado sensible**: ajústalo por cámara en *Cámaras → Movimiento*.
