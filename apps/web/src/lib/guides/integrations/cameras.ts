import type { IntegrationGuide } from '../types';

/**
 * Guía de cámaras IP por RTSP (dominio 'camera', categoría 'cameras').
 * No había doc de origen: escrita desde cero en español llano, alineada con la
 * definición de cámara del backend (name/room/model/rtspUrl, transporte tcp/udp).
 */

const rtsp: IntegrationGuide = {
  id: 'rtsp',
  domain: 'camera',
  kind: 'rtsp',
  category: 'cameras',
  displayName: 'Cámara IP (RTSP)',
  vendor: 'Genérico (Hikvision, Dahua, Reolink, TP-Link Tapo...)',
  icon: 'Camera',
  tier: 3,
  intro:
    'La mayoría de las cámaras de vigilancia por red (Hikvision, Dahua, Reolink, TP-Link y muchas más) emiten su vídeo en directo mediante una dirección especial llamada RTSP. Si le das a KrakenOS esa dirección, podrá mostrarte imágenes de tu cámara sin depender de la nube del fabricante. Todo se queda en tu casa. Solo necesitas encontrar esa dirección RTSP en tu cámara.',
  prerequisites: [
    'Una cámara IP conectada a tu red con RTSP activado (casi todas lo tienen; a veces hay que encenderlo en sus ajustes).',
    'La dirección RTSP de la cámara (empieza por rtsp://). Suele incluir un usuario y contraseña.',
    'Recomendado: reservar una IP fija a la cámara en el router para que la dirección no cambie.',
  ],
  steps: [
    {
      title: 'Activa RTSP y crea un usuario en la cámara',
      body: 'Entra en los ajustes de tu cámara (por su app o su página web) y asegúrate de que RTSP está habilitado. Muchas marcas piden crear un usuario y contraseña específicos para el acceso por RTSP; hazlo y anótalos.',
      external: true,
    },
    {
      title: 'Averigua la dirección RTSP',
      body: 'La dirección RTSP tiene esta forma: rtsp://usuario:contraseña@IP-de-la-cámara:554/ruta. El "554" es el puerto habitual y la "ruta" del final depende de la marca (a veces es /stream1, /h264, /Streaming/Channels/101...). La encuentras en el manual de la cámara, en su app, o buscando el modelo por internet.',
      command: 'rtsp://usuario:contraseña@192.168.1.20:554/stream1',
      note: 'Consejo: reserva una IP fija a la cámara en el router para que esta dirección no cambie con el tiempo.',
      external: true,
    },
    {
      title: 'Añade la cámara en KrakenOS',
      body: 'Ponle un nombre a la cámara, pega su dirección RTSP y, si quieres, indica en qué habitación está y el modelo. La dirección RTSP contiene la contraseña, así que se guarda cifrada y no se vuelve a mostrar. Al guardar, KrakenOS podrá capturar imágenes de la cámara.',
    },
  ],
  fields: [
    {
      key: 'name',
      label: 'Nombre de la cámara',
      help: 'Un nombre para reconocerla, por ejemplo "Entrada" o "Jardín".',
      type: 'text',
      placeholder: 'Entrada',
      required: true,
    },
    {
      key: 'rtspUrl',
      label: 'Dirección RTSP',
      help: 'La dirección del vídeo de la cámara, empezando por rtsp://. Suele incluir usuario y contraseña, por eso se guarda cifrada y no se muestra de nuevo.',
      type: 'url',
      placeholder: 'rtsp://usuario:contraseña@192.168.1.20:554/stream1',
      required: true,
      secret: true,
    },
    {
      key: 'room',
      label: 'Habitación (opcional)',
      help: 'Dónde está la cámara, para organizarla mejor. Por ejemplo "Salón".',
      type: 'text',
      placeholder: 'Salón',
      required: false,
    },
    {
      key: 'model',
      label: 'Modelo (opcional)',
      help: 'El modelo de la cámara, solo a título informativo.',
      type: 'text',
      placeholder: 'Reolink RLC-810A',
      required: false,
    },
    {
      key: 'transport',
      label: 'Transporte',
      help: 'Cómo viaja el vídeo. "TCP" es más estable y funciona en casi todos los casos; "UDP" es más rápido pero puede fallar. Deja TCP si no estás seguro.',
      type: 'select',
      required: false,
      defaultValue: 'tcp',
      options: [
        { value: 'tcp', label: 'TCP (recomendado)' },
        { value: 'udp', label: 'UDP' },
      ],
    },
  ],
  troubleshooting: [
    {
      q: 'La cámara aparece pero no da imagen.',
      a: 'Casi siempre es un error en la dirección RTSP: revisa el usuario, la contraseña, la IP y sobre todo la "ruta" del final (varía mucho entre marcas). Prueba también a cambiar el transporte a TCP.',
    },
    {
      q: 'No sé cuál es mi dirección RTSP.',
      a: 'Búscala por el modelo exacto de tu cámara: casi todas las marcas publican el formato de su dirección RTSP. También suele estar en el manual o en los ajustes avanzados de la cámara.',
    },
    {
      q: '¿Puedo ver el vídeo en directo continuo?',
      a: 'Sí: en la página de Cámaras, el botón «Ver en vivo» abre el vídeo en directo. El servidor necesita tener ffmpeg instalado; el vídeo solo se procesa mientras alguien mira.',
    },
  ],
};

/**
 * Frigate (US-214): el NVR delegado. Para detección por objetos (persona,
 * coche…), pre-roll y grabación continua, KrakenOS no compite — se conecta a
 * un Frigate existente y hereda su detección. El detector propio queda como
 * básico integrado para quien no tiene Frigate.
 */
const frigate: IntegrationGuide = {
  id: 'frigate',
  domain: 'camera',
  kind: 'frigate',
  category: 'cameras',
  displayName: 'Frigate (NVR con detección de objetos)',
  vendor: 'Frigate (frigate.video)',
  icon: 'Camera',
  tier: 2,
  intro:
    'Frigate es un grabador de vídeo en red (NVR) gratuito que detecta objetos con inteligencia artificial: sabe distinguir una persona de un coche o un gato. Si ya lo tienes (o quieres cámaras «serias»), KrakenOS se conecta a él y hereda esa detección: sus cámaras aparecen aquí, los avisos llegan con lo que se detectó («persona en la entrada») y las grabaciones de Frigate se ven desde KrakenOS. Es la vía recomendada para vigilancia de verdad; el detector propio de KrakenOS es más básico y queda para instalaciones sin Frigate.',
  prerequisites: [
    'Un servidor Frigate funcionando en tu red local (frigate.video tiene la guía de instalación).',
    'La dirección de Frigate (por ejemplo http://192.168.1.30:5000).',
    'Las cámaras ya configuradas dentro de Frigate (KrakenOS las lista tal cual).',
  ],
  steps: [
    {
      title: 'Localiza la dirección de Frigate',
      body: 'Es la misma dirección con la que abres la interfaz de Frigate en el navegador, normalmente el puerto 5000. KrakenOS hablará con ella solo dentro de tu red; esa dirección nunca se comparte con el navegador ni sale de casa.',
      command: 'http://192.168.1.30:5000',
      external: true,
    },
    {
      title: 'Conéctalo en KrakenOS',
      body: 'Pega la dirección y guarda. Las cámaras de Frigate aparecerán en la página de Cámaras; el vídeo en vivo y las grabaciones se sirven a través de KrakenOS, autenticados como todo lo demás.',
    },
    {
      title: 'Activa los avisos por cámara',
      body: 'En cada cámara, abre los ajustes de movimiento y actívalos. Con Frigate, los avisos llegan con el objeto detectado, y en las automatizaciones puedes filtrar por él: «si detecta persona en la Entrada → enciende la luz».',
    },
  ],
  fields: [
    {
      key: 'url',
      label: 'Dirección de Frigate',
      help: 'La URL de tu servidor Frigate en la red local, normalmente con el puerto 5000.',
      type: 'url',
      placeholder: 'http://192.168.1.30:5000',
      required: true,
    },
    {
      key: 'go2rtcUrl',
      label: 'Dirección del vídeo en vivo (opcional)',
      help: 'Solo si cambiaste el puerto del go2rtc que trae Frigate. Vacío = el mismo servidor en el puerto 1984.',
      type: 'url',
      placeholder: 'http://192.168.1.30:1984',
      required: false,
    },
  ],
  troubleshooting: [
    {
      q: 'Las cámaras no aparecen.',
      a: 'Comprueba que la dirección de Frigate abre su interfaz desde otro dispositivo de la red y que las cámaras están configuradas dentro de Frigate. KrakenOS lista exactamente las que Frigate conoce.',
    },
    {
      q: 'Los avisos no dicen qué se detectó.',
      a: 'El objeto detectado (persona, coche…) lo pone Frigate. Revisa que la detección por objetos esté activa en la configuración de Frigate para esa cámara.',
    },
    {
      q: '¿Y la detección de movimiento propia de KrakenOS?',
      a: 'Con Frigate conectado se apaga sola: la detección vive en Frigate (que lo hace mejor) y KrakenOS no la duplica. Los ajustes de aviso por cámara (activado, horario de armado, tiempo entre avisos) siguen mandando.',
    },
    {
      q: '¿Puedo borrar grabaciones desde KrakenOS?',
      a: 'No: las grabaciones viven en Frigate y su retención se configura allí. KrakenOS las lista y las descarga, honesto y sin duplicar la gestión.',
    },
  ],
};

export const CAMERA_GUIDES: IntegrationGuide[] = [rtsp, frigate];
