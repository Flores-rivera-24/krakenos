# Alertas: push, email y Telegram

KrakenOS avisa de eventos de seguridad y del hogar por tres canales. Qué evento va por qué canal se
elige en **Ajustes → Alertas** (una fila por evento, un interruptor por canal). Los canales email y
Telegram **no existen** hasta que configuras sus variables: sin ellas no sale ninguna petición.

Eventos del catálogo (`ALERT_EVENTS`, `packages/types/src/alert.ts`):

| Grupo   | Eventos                                                                                |
| ------- | -------------------------------------------------------------------------------------- |
| Acceso  | login fallido, cuenta bloqueada, reuso de refresh token, uso de código de recuperación |
| Red     | dispositivo bloqueado, MAC desconocida en la red, destino DNS nuevo                    |
| Hogar   | umbral de energía, movimiento en cámara                                                |
| Alarma  | disparo, humo, CO, fallo de sensor, desarme denegado                                   |
| Sistema | certificado TLS a punto de caducar                                                     |

Además hay un **resumen del hogar** (apagado, diario a las 08:00 o semanal los lunes a las 08:00,
en **Ajustes → Notificaciones**), que sale por los canales configurados.

---

## Push (Web Push)

No necesita configuración: las claves **VAPID** se generan solas al arrancar. Cada usuario activa
los avisos en su navegador desde **Ajustes → Notificaciones**.

Requisito: la app tiene que servirse por **HTTPS** (o `localhost`); sobre HTTP el navegador no
permite suscribirse. Ver [`remote-access.md`](remote-access.md#https-con-un-certificado-en-el-que-tu-móvil-confía).
En iPhone, además, la app tiene que estar **instalada** en la pantalla de inicio.

## Email (SMTP)

Requiere el paquete **`nodemailer`**, que **no** viene con el agente (se carga solo si hay SMTP
configurado; si falta, el envío falla y el error queda en el log). Se puede añadir en una
instalación por git, donde existe `pnpm`:

```bash
cd /opt/krakenos/apps/agent && pnpm add nodemailer
```

> **Limitación:** en la imagen Docker y en los paquetes (`.deb`, Arch, Windows) no hay un camino
> documentado para instalarlo, así que **el email solo está disponible hoy en la instalación por
> git**. Push y Telegram no tienen esa limitación.

```env
SMTP_HOST=smtp.tu-proveedor.com
SMTP_PORT=587
SMTP_SECURE=false            # true para el 465 (TLS implícito)
SMTP_USER=usuario
SMTP_PASS=contraseña         # en Gmail/Outlook: una contraseña de aplicación
SMTP_FROM=krakenos@tu-dominio.com
ALERT_EMAIL_TO=tu-email@ejemplo.com
```

El canal se activa solo si están **`SMTP_HOST` y `ALERT_EMAIL_TO`**. Reinicia el agente.

## Telegram

1. Habla con **@BotFather** → `/newbot` → copia el **token**.
2. Escribe cualquier cosa a tu bot (si no, no puede escribirte), y obtén tu **chat id** con
   **@userinfobot**. Para un grupo, añade el bot al grupo y usa el id del grupo (negativo).
3. En el `.env`:

   ```env
   TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
   TELEGRAM_CHAT_ID=123456789
   ```

4. Reinicia y activa Telegram en los eventos que quieras (Ajustes → Alertas).

> **Privacidad:** Telegram es nube de un tercero. Antes de enviar, KrakenOS **enmascara** las MACs
> (solo los últimos octetos) y sustituye las IPs por «la red local»; el token del bot se redacta de
> los logs. Las fotos de movimiento sí se envían si activas ese evento por Telegram.

> **Sin verificar de extremo a extremo.** Push, SMTP y Telegram están probados contra envíos
> simulados; no consta una prueba con un servidor SMTP ni un bot reales.

## Probar

No hay botón de prueba: provoca un evento barato con su canal activado (por ejemplo, un **login
fallido** con una contraseña errónea). Si no llega, el error sale en el log del agente
(`journalctl -u krakenos -f`).
