# KrakenOS como app de escritorio

Esta guía explica cómo usar KrakenOS como una aplicación más: con su icono, su propia ventana y sin
terminal en el uso diario. Es para quien ya tiene KrakenOS instalado (o lo va a instalar). El porqué de
las decisiones está en [`adr-app-escritorio.md`](adr-app-escritorio.md).

## Cómo funciona

KrakenOS son dos piezas separadas:

- **El servicio** (el agente) es quien vigila: escanea la red, aplica los horarios de control parental,
  arma la alarma, detecta movimiento, ejecuta rutinas y manda avisos. Corre en un equipo encendido y
  arranca solo con él.
- **La ventana** (la interfaz web, instalada como app) solo **muestra**. Cerrarla no para nada: el
  servicio sigue vigilando.

Por eso un ordenador que se suspende o se apaga **no vigila**: con el servicio parado no se aplican los
horarios, la alarma y la detección de movimiento no funcionan, las rutinas no se ejecutan y los
históricos (tráfico, energía, DNS) tienen huecos. No es un fallo, es lo que pasa cuando nadie está
mirando. Si quieres vigilancia continua, el servicio tiene que vivir en un equipo que no se apague.

## Perfil recomendado

KrakenOS en un equipo siempre encendido (una Raspberry Pi, un mini PC), instalado con el instalador, y
la app instalada en cada ordenador, móvil o tablet desde el que quieras abrirlo.

Desde esta versión, el instalador activa HTTPS por sí solo (`--tls auto`):

- Si el equipo tiene **Tailscale** con sesión iniciada, usa su certificado. Todos los dispositivos lo
  aceptan sin hacer nada.
- Si no, crea una **CA local de KrakenOS** y firma con ella el certificado del servidor. Cada
  dispositivo tiene que confiar en esa CA una vez (siguiente sección).

Las banderas del instalador están en el [`README`](../README.md). Hace falta HTTPS porque el navegador
solo ofrece instalar la app, recibir avisos push y usar passkeys en una conexión segura.

## Instalar el certificado en cada dispositivo

Solo hace falta con la CA local. Con Tailscale, sáltate esta sección.

Descarga el certificado de la CA desde Ajustes → Sistema, en la tarjeta «Conexión segura (HTTPS)», o
abriendo `https://<equipo>.local:3001/api/system/ca-cert` (cambia `<equipo>` por el nombre de tu equipo).

**Por qué es seguro:** la CA de KrakenOS solo puede firmar nombres `.local`, `localhost` y direcciones
IP privadas. Aunque alguien se hiciera con su clave, no serviría para suplantar ningún sitio de
internet.

Los nombres exactos de los menús varían según la versión del sistema; estos pasos son orientativos.

- **Windows:** abre el archivo descargado, pulsa «Instalar certificado», elige «Equipo local» y colócalo
  en «Entidades de certificación raíz de confianza». Reinicia el navegador.
- **macOS:** abre el archivo (se añade a «Llavero»), busca «KrakenOS» en el llavero «Sistema», abre su
  ficha y en «Confiar» elige «Confiar siempre».
- **Android:** Ajustes → Seguridad → Cifrado y credenciales → Instalar un certificado → «Certificado
  de CA», y elige el archivo.
- **iPhone y iPad:** abre el archivo en Safari y permite descargar el perfil. Instálalo en Ajustes →
  «Perfil descargado». Después **activa la confianza**, que es un paso aparte: Ajustes → General →
  Información → Confianza de certificados → activa «KrakenOS». Sin este segundo paso el perfil está
  instalado pero iOS no se fía de él.

## Instalar la app

- **Edge o Chrome en Windows, macOS o Linux:** abre KrakenOS y pulsa el botón de la tarjeta «Instalar
  como app» en Ajustes → Sistema, o el icono de instalar que aparece en la barra de direcciones.
- **Android:** en Chrome, menú ⋮ → «Instalar app».
- **iPhone y iPad:** en Safari, Compartir → «Añadir a pantalla de inicio».

Para que se abra al iniciar sesión en Windows con Edge: ve a `edge://apps`, elige KrakenOS y activa
«Iniciar automáticamente al iniciar sesión en el dispositivo». Los nombres exactos del menú pueden
variar según la versión.

La sesión dura 30 días con «Mantener sesión iniciada», así que al abrir la app entras directo.

## Avisos con la app cerrada

Los avisos push dependen de que el navegador siga activo en segundo plano; con la app cerrada y el
navegador del todo cerrado, pueden no llegar. Para lo crítico (alarma, humo, CO) configura **Telegram o
correo** en Ajustes → Alertas: los manda el servicio y no dependen de ninguna ventana.

## Alternativa: todo en tu propio Windows

Existe un segundo perfil, para quien quiere todo en su ordenador Windows: el servicio corre dentro de
WSL2 y la app se instala desde `http://localhost:3001`, que no necesita certificado. **Hoy no tiene
instalador propio**: es un montaje manual y está por verificar en una máquina real. Sus límites:

| Función | En este perfil |
|---|---|
| Vigilancia, alarma, movimiento, presencia, rutinas, avisos | Solo con el ordenador encendido y la sesión iniciada |
| Horarios de control parental | Pueden no empezar o no terminar a su hora |
| Servidor WireGuard, cortafuegos, QoS | No aplicables: actuarían sobre WSL, no sobre tu red |
| Descubrimiento mDNS/SSDP, Govee, puente Matter | Dependen de la red `mirrored` de WSL; por verificar |
| Actualización con un clic | Por verificar |

El razonamiento completo está en [`adr-app-escritorio.md`](adr-app-escritorio.md).

## Problemas frecuentes

- **No aparece el botón de instalar.** Falta HTTPS (sobre HTTP plano el navegador no ofrece instalar) o
  tu navegador no lo ofrece: Firefox de escritorio no instala apps. Prueba con Edge o Chrome.
- **El navegador dice «sitio no seguro».** Falta instalar el certificado de la CA en ese dispositivo
  (sección «Instalar el certificado en cada dispositivo»). En iPhone y iPad, comprueba también el paso
  de la confianza.
- **Abrí la app y dice que no llega a tu casa.** El servicio está apagado o ese dispositivo está en otra
  red. Comprueba que el equipo con KrakenOS está encendido y, si estás fuera de casa, conecta primero
  por [acceso remoto](remote-access.md).
- **Tengo dos ventanas.** Abre siempre KrakenOS desde el icono de la app instalada, no desde una pestaña
  del navegador.
