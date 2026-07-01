import type { IntegrationGuide } from '../types';

/**
 * Guías de luces inteligentes (dominio 'iot', categoría 'lights'):
 * Hue, Govee y Tuya (internalizadas de sus docs) + Zigbee y Matter
 * (sin doc de origen: escritas desde cero en español llano).
 */

const hue: IntegrationGuide = {
  id: 'hue',
  domain: 'iot',
  kind: 'hue',
  category: 'lights',
  displayName: 'Philips Hue',
  vendor: 'Signify / Philips',
  icon: 'Lightbulb',
  tier: 2,
  intro:
    'Philips Hue es uno de los sistemas de iluminación inteligente más conocidos. Sus bombillas hablan con una cajita blanca llamada "bridge" (puente), que se conecta a tu router por cable. KrakenOS controla tus luces a través de ese bridge, todo dentro de tu casa y sin pasar por internet. Podrás encender, apagar, regular el brillo y cambiar el color desde una sola pantalla.',
  prerequisites: [
    'El bridge (puente) de Hue conectado a tu router y funcionando, con tus bombillas ya emparejadas.',
    'Saber la dirección IP del bridge en tu red (te ayudamos a encontrarla).',
    'Acceso físico al bridge para pulsar su botón redondo una vez.',
  ],
  steps: [
    {
      title: 'Encuentra la dirección del bridge',
      body: 'Busca en la lista de aparatos de KrakenOS (o en tu router) el dispositivo cuyo fabricante sea "Philips" o "Signify": esa es la dirección de tu bridge. También puedes visitar la página de descubrimiento de Philips desde tu red, que te devuelve la IP interna del bridge.',
      command: 'https://discovery.meethue.com/',
      external: true,
    },
    {
      title: 'Autoriza a KrakenOS con el botón del bridge',
      body: 'Para que KrakenOS controle tus luces, el bridge tiene que darle permiso una vez. En este paso, pulsa el botón redondo grande del bridge y luego confirma en la app: KrakenOS obtendrá una "clave de aplicación" que guarda para no tener que repetir el permiso.',
      note: 'Tras pulsar el botón tienes unos 30 segundos para confirmar. Si se pasa el tiempo, vuelve a intentarlo.',
      external: true,
    },
    {
      title: 'Guarda y prueba',
      body: 'Una vez autorizado, tus focos Hue aparecen en la pantalla de dispositivos. Prueba a encender, apagar, subir el brillo y cambiar el color. Si algo no responde, revisa que la dirección del bridge sea correcta.',
    },
  ],
  fields: [
    {
      key: 'bridgeUrl',
      label: 'Dirección del bridge',
      help: 'La dirección del puente Hue en tu red, empezando por https://. Por ejemplo https://192.168.1.50.',
      type: 'url',
      placeholder: 'https://192.168.1.50',
      required: true,
    },
    {
      key: 'appKey',
      label: 'Clave de aplicación',
      help: 'La llave que genera el bridge al pulsar su botón. Si el asistente la obtiene por ti al autorizar, no tienes que escribir nada. Se guarda cifrada.',
      type: 'password',
      required: true,
      secret: true,
    },
  ],
  troubleshooting: [
    {
      q: 'Al autorizar me dice que no pulsé el botón a tiempo.',
      a: 'Pulsa el botón redondo del bridge e, inmediatamente después (menos de 30 segundos), confirma en la app. Si tardas, el bridge rechaza la petición y hay que repetir.',
    },
    {
      q: 'No aparecen mis bombillas.',
      a: 'Comprueba que las bombillas están emparejadas con el bridge (aparecen en la app oficial de Hue) y que la dirección del bridge es correcta.',
    },
    {
      q: 'El sistema avisa de un certificado no fiable del bridge.',
      a: 'El bridge usa un certificado creado por él mismo para tu red local. Es normal en una conexión dentro de casa y no supone un problema de seguridad.',
    },
  ],
};

const govee: IntegrationGuide = {
  id: 'govee',
  domain: 'iot',
  kind: 'govee',
  category: 'lights',
  displayName: 'Govee',
  vendor: 'Govee',
  icon: 'Lightbulb',
  tier: 1,
  intro:
    'Govee hace tiras y focos LED muy populares y económicos. Muchos de sus modelos permiten el "control local", es decir, dejar que KrakenOS los maneje directamente por tu red WiFi sin pasar por la nube de Govee. Es de lo más fácil de conectar: basta con activar una opción en la app de Govee. Podrás encender, apagar, regular el brillo y cambiar el color.',
  prerequisites: [
    'Luces Govee que soporten "LAN Control" (control local). No todos los modelos lo tienen.',
    'La app Govee Home instalada en tu móvil.',
    'Que el servidor de KrakenOS y las luces estén en la misma red WiFi (misma subred).',
  ],
  steps: [
    {
      title: 'Activa "LAN Control" en la app Govee',
      body: 'El control local viene desactivado de fábrica. Para cada foco o tira: abre la app Govee Home, entra en el dispositivo, toca el icono de ajustes (arriba a la derecha) y activa "LAN Control". Si esa opción no aparece, ese modelo no se puede controlar localmente.',
      external: true,
    },
    {
      title: 'Asegura que están en la misma red',
      body: 'KrakenOS descubre las luces Govee enviando un "aviso" por la red local. Para que llegue, el servidor de KrakenOS y las luces deben estar en la misma red WiFi. Si tienes los aparatos inteligentes en una red separada (VLAN), este descubrimiento no cruza de una red a otra por sí solo.',
      note: 'El protocolo local de Govee no usa contraseña ni token, por eso conviene tener los aparatos inteligentes en su propia red.',
      external: true,
    },
    {
      title: 'Guarda y espera unos segundos',
      body: 'No hace falta ninguna clave. Al guardar, las luces van apareciendo conforme responden (puede tardar unos segundos). Si quieres, puedes indicar un puerto de escucha concreto; si no, se usa el habitual.',
    },
  ],
  fields: [
    {
      key: 'listenPort',
      label: 'Puerto de escucha (opcional)',
      help: 'La "puerta" por la que KrakenOS escucha las respuestas de las luces. Déjalo vacío para usar el valor habitual del protocolo Govee (4002).',
      type: 'number',
      placeholder: '4002',
      required: false,
    },
  ],
  troubleshooting: [
    {
      q: 'No aparece ninguna luz Govee.',
      a: 'Confirma que activaste "LAN Control" en cada dispositivo, que el servidor está en la misma red WiFi que las luces y que el cortafuegos del servidor no bloquea el tráfico. Al recargar la pantalla de dispositivos se lanza un nuevo barrido.',
    },
    {
      q: 'No encuentro "LAN Control" en la app.',
      a: 'Ese modelo concreto no soporta control local y solo funcionaría por la nube de Govee, que queda fuera de KrakenOS. Revisa la compatibilidad del modelo.',
    },
  ],
};

const tuya: IntegrationGuide = {
  id: 'tuya',
  domain: 'iot',
  kind: 'tuya',
  category: 'lights',
  displayName: 'Tuya / Smart Life',
  vendor: 'Tuya (marcas blancas: EASYTAO y similares)',
  icon: 'Lightbulb',
  tier: 4,
  intro:
    'Muchos focos "inteligentes" baratos de Amazon (EASYTAO y similares) funcionan por dentro con la tecnología Tuya, aunque la marca sea otra. KrakenOS puede controlarlos localmente, sin la nube, pero para ello necesita una clave secreta de cada foco (la "local key"). Conseguir esa clave es la parte laboriosa: hay que crear una cuenta gratuita en el portal de desarrollo de Tuya. Es la integración de luces que más pasos tiene.',
  prerequisites: [
    'Los focos ya emparejados en la app Smart Life (o Tuya Smart) y conectados a tu WiFi.',
    'Una cuenta gratuita en el portal de desarrollo de Tuya (iot.tuya.com) para obtener las claves.',
    'La dirección IP local de cada foco (mejor si le reservas una IP fija en el router).',
    'Por cada foco necesitarás tres datos: su identificador (Device ID), su clave local (Local Key) y su IP.',
  ],
  steps: [
    {
      title: 'Empareja los focos en Smart Life',
      body: 'Instala la app Smart Life (o Tuya Smart) en el móvil, crea una cuenta y empareja cada foco siguiendo la app, de modo que queden conectados a tu WiFi. Este es el uso normal de estos focos.',
      external: true,
    },
    {
      title: 'Obtén el Device ID y la Local Key',
      body: 'La clave local no está en la app: hay que sacarla del portal de desarrollo de Tuya. Crea una cuenta gratuita en iot.tuya.com, crea un proyecto en la nube, vincula tu cuenta de Smart Life y, en la lista de dispositivos, verás el "Device ID" y la "Local Key" de cada foco. Es un proceso algo técnico pero solo se hace una vez.',
      command: 'https://iot.tuya.com',
      note: 'Alternativa más cómoda: la herramienta oficial "npx @tuyapi/cli wizard" te lista cada foco con su id, su clave y su IP a partir de las credenciales del proyecto.',
      external: true,
    },
    {
      title: 'Averigua la IP de cada foco',
      body: 'Mira la dirección IP de cada foco en tu router o en la lista de aparatos de KrakenOS (busca por fabricante o nombre). Muy recomendable: reserva una IP fija para cada foco en el router, así no cambia con el tiempo y no se te desconectan.',
      external: true,
    },
    {
      title: 'Registra cada foco en KrakenOS',
      body: 'Añade cada foco con su nombre, su IP, su Device ID y su Local Key. Elige la versión del protocolo (si no la sabes, prueba con 3.3, la más común). La clave local se guarda cifrada y nunca se vuelve a mostrar. Repite por cada foco que quieras controlar.',
    },
  ],
  fields: [
    {
      key: 'name',
      label: 'Nombre del foco',
      help: 'Un nombre para reconocerlo, por ejemplo "Foco salón".',
      type: 'text',
      placeholder: 'Foco salón',
      required: true,
    },
    {
      key: 'ip',
      label: 'Dirección IP del foco',
      help: 'La IP local del foco en tu red. Mejor si es una IP fija reservada en el router.',
      type: 'ip',
      placeholder: '192.168.1.80',
      required: true,
    },
    {
      key: 'deviceId',
      label: 'Identificador (Device ID)',
      help: 'El identificador único del foco que aparece en el portal de desarrollo de Tuya.',
      type: 'text',
      placeholder: 'bf1234567890abcdef',
      required: true,
    },
    {
      key: 'localKey',
      label: 'Clave local (Local Key)',
      help: 'La clave secreta del foco obtenida del portal de Tuya. Se guarda cifrada y nunca se muestra de nuevo. Si vuelves a emparejar el foco, esta clave cambia.',
      type: 'password',
      required: true,
      secret: true,
    },
    {
      key: 'version',
      label: 'Versión del protocolo',
      help: 'La versión del protocolo Tuya del foco. Si no la conoces, prueba con 3.3 (la más habitual).',
      type: 'select',
      required: false,
      defaultValue: '3.3',
      options: [
        { value: '3.1', label: '3.1' },
        { value: '3.3', label: '3.3 (habitual)' },
        { value: '3.4', label: '3.4' },
      ],
    },
  ],
  troubleshooting: [
    {
      q: 'Un foco deja de responder de repente.',
      a: 'Lo más probable es que la clave local haya cambiado (ocurre si desvinculas y vuelves a vincular el foco en Smart Life). Vuelve a obtener la clave del portal de Tuya y actualízala en el foco.',
    },
    {
      q: 'El foco aparece como "no accesible".',
      a: 'Comprueba que la IP es correcta y no ha cambiado (por eso conviene reservarla fija), y que el foco está encendido y en tu WiFi. Se muestra su último estado conocido.',
    },
    {
      q: '¿Puedo cambiar el color?',
      a: 'De momento estos focos se controlan con encendido/apagado y brillo. El control de color para Tuya es una mejora prevista para más adelante.',
    },
  ],
};

const zigbee: IntegrationGuide = {
  id: 'zigbee',
  domain: 'iot',
  kind: 'zigbee',
  category: 'lights',
  displayName: 'Zigbee (zigbee2mqtt)',
  vendor: 'Varios (IKEA Trådfri, Aqara, Sonoff...)',
  icon: 'Lightbulb',
  tier: 3,
  intro:
    'Zigbee es una tecnología de bajo consumo que usan muchísimas bombillas, sensores y enchufes de distintas marcas (IKEA Trådfri, Aqara, Sonoff y más). Para controlarlos sin la nube se usa un programa llamado zigbee2mqtt, que hace de traductor entre tus aparatos Zigbee y tu red. KrakenOS se conecta a ese traductor a través de un "cartero" de mensajes (un broker MQTT) para manejar tus luces.',
  prerequisites: [
    'Un adaptador Zigbee (una especie de USB) conectado a tu servidor.',
    'El programa zigbee2mqtt instalado y funcionando, con tus aparatos ya emparejados.',
    'Un broker MQTT (por ejemplo Mosquitto) en tu red, que es donde zigbee2mqtt publica los mensajes.',
  ],
  steps: [
    {
      title: 'Ten funcionando zigbee2mqtt y el broker',
      body: 'Antes de conectar KrakenOS, necesitas dos cosas en marcha en tu servidor: un broker MQTT (como Mosquitto), que es el "cartero" que reparte los mensajes, y el programa zigbee2mqtt, que habla con tus aparatos Zigbee y publica sus estados en el broker. Empareja tus bombillas en zigbee2mqtt.',
      external: true,
    },
    {
      title: 'Anota la dirección del broker',
      body: 'Necesitas la dirección del broker MQTT, que empieza por "mqtt://" seguido de la IP y el puerto (el habitual es 1883). Por ejemplo mqtt://192.168.1.5:1883. También conviene saber el "tema base" que usa zigbee2mqtt para sus mensajes (por defecto es "zigbee2mqtt").',
      external: true,
    },
    {
      title: 'Conecta KrakenOS',
      body: 'Pon la dirección del broker y el tema base. Al guardar, KrakenOS se suscribe a los mensajes de tus aparatos Zigbee y los muestra como luces que puedes controlar.',
    },
  ],
  fields: [
    {
      key: 'brokerUrl',
      label: 'Dirección del broker MQTT',
      help: 'La dirección del "cartero" de mensajes, empezando por mqtt://. Por ejemplo mqtt://192.168.1.5:1883.',
      type: 'url',
      placeholder: 'mqtt://192.168.1.5:1883',
      required: true,
    },
    {
      key: 'baseTopic',
      label: 'Tema base',
      help: 'El nombre que usa zigbee2mqtt para sus mensajes. Por defecto es "zigbee2mqtt"; déjalo así salvo que lo hayas cambiado.',
      type: 'text',
      placeholder: 'zigbee2mqtt',
      required: false,
      defaultValue: 'zigbee2mqtt',
    },
  ],
  troubleshooting: [
    {
      q: 'No aparece ningún aparato Zigbee.',
      a: 'Comprueba que zigbee2mqtt está funcionando y ha emparejado tus dispositivos, que el broker MQTT está en marcha, y que la dirección del broker y el tema base son correctos.',
    },
    {
      q: '¿Qué es exactamente un broker MQTT?',
      a: 'Es un programa que hace de oficina de correos: los aparatos dejan mensajes ahí y KrakenOS los recoge, y viceversa. Mosquitto es el más común y es gratuito.',
    },
  ],
};

const matter: IntegrationGuide = {
  id: 'matter',
  domain: 'iot',
  kind: 'matter',
  category: 'lights',
  displayName: 'Matter',
  vendor: 'Varios (estándar Matter)',
  icon: 'Lightbulb',
  tier: 3,
  intro:
    'Matter es un estándar nuevo que busca que los aparatos inteligentes de distintas marcas se entiendan entre sí. Para controlarlos localmente se usa un pequeño servicio ("matter-server") que hace de intermediario. KrakenOS se conecta a él para manejar tus luces y otros dispositivos compatibles con Matter, todo dentro de tu casa.',
  prerequisites: [
    'Un servicio matter-server funcionando en tu red, con tus aparatos Matter ya vinculados.',
    'La dirección de conexión de ese servicio (empieza por ws://).',
  ],
  steps: [
    {
      title: 'Ten funcionando el matter-server',
      body: 'Instala y arranca un matter-server en tu servidor o red y vincula en él tus dispositivos Matter. Este servicio es el que habla realmente con los aparatos; KrakenOS se apoya en él.',
      external: true,
    },
    {
      title: 'Anota la dirección de conexión',
      body: 'El matter-server ofrece una dirección de conexión que empieza por "ws://" (una conexión en tiempo real). Por ejemplo ws://192.168.1.5:5580/ws. Esa es la dirección que pondrás abajo.',
      external: true,
    },
    {
      title: 'Conecta KrakenOS',
      body: 'Pega la dirección de conexión del matter-server. Al guardar, KrakenOS se enlaza con él y muestra tus dispositivos Matter listos para controlar.',
    },
  ],
  fields: [
    {
      key: 'serverUrl',
      label: 'Dirección del matter-server',
      help: 'La dirección de conexión en tiempo real del servicio, empezando por ws://. Por ejemplo ws://192.168.1.5:5580/ws.',
      type: 'url',
      placeholder: 'ws://192.168.1.5:5580/ws',
      required: true,
    },
  ],
  troubleshooting: [
    {
      q: 'No conecta con el matter-server.',
      a: 'Verifica que el servicio está en marcha y accesible desde el servidor de KrakenOS, y que la dirección empieza por ws:// con el puerto correcto.',
    },
    {
      q: 'No veo mis dispositivos Matter.',
      a: 'Los aparatos deben estar vinculados dentro del matter-server. KrakenOS solo muestra lo que ese servicio ya gestiona.',
    },
  ],
};

export const LIGHT_GUIDES: IntegrationGuide[] = [hue, govee, tuya, zigbee, matter];
