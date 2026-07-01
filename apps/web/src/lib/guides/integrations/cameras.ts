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
      body: 'La dirección RTSP tiene esta forma: rtsp://usuario:contraseña@IP-de-la-camara:554/ruta. El "554" es el puerto habitual y la "ruta" del final depende de la marca (a veces es /stream1, /h264, /Streaming/Channels/101...). La encuentras en el manual de la cámara, en su app, o buscando el modelo por internet.',
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
      a: 'Por ahora KrakenOS toma imágenes (capturas) de la cámara. El vídeo en directo continuo en el navegador es una función prevista para más adelante.',
    },
  ],
};

export const CAMERA_GUIDES: IntegrationGuide[] = [rtsp];
