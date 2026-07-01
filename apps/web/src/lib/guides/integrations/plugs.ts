import type { IntegrationGuide } from '../types';

/**
 * Guías de enchufes e interruptores inteligentes (dominio 'iot', categoría 'plugs'):
 * Kasa, Tapo, Shelly, Meross y SwitchBot. Internalizadas de sus docs y reescritas
 * en español llano para el asistente.
 */

const kasa: IntegrationGuide = {
  id: 'kasa',
  domain: 'iot',
  kind: 'kasa',
  category: 'plugs',
  displayName: 'TP-Link Kasa',
  vendor: 'TP-Link',
  icon: 'Plug',
  tier: 1,
  intro:
    'Los enchufes, interruptores y focos Kasa de TP-Link (los de la generación 1 y 2, como el HS103 o el HS200) se pueden controlar directamente por tu red WiFi, sin la app ni la nube de TP-Link. Y lo mejor: normalmente se encuentran solos, sin que tengas que configurar nada. Podrás encenderlos y apagarlos, y regular el brillo o el color en los modelos que lo permitan.',
  prerequisites: [
    'Enchufes o interruptores Kasa (generación 1/2) ya configurados y conectados a tu WiFi.',
    'Que el servidor de KrakenOS esté en la misma red que los Kasa (para el descubrimiento automático).',
    'Recomendado: reservarles una IP fija en el router.',
  ],
  steps: [
    {
      title: 'Deja que se descubran solos',
      body: 'Los Kasa de generación 1 y 2 responden a una "llamada" que KrakenOS lanza por la red, así que en la mayoría de casos aparecen solos sin configurar nada. Si es tu caso, guarda dejando el campo de direcciones vacío.',
    },
    {
      title: 'Si no aparecen, añade sus direcciones',
      body: 'Si tienes los aparatos inteligentes en una red separada y la llamada no les llega, escribe sus direcciones IP a mano, separadas por comas. Verás la IP de cada Kasa en tu router o en la app Kasa.',
      note: 'Consejo: asigna una IP fija a cada Kasa en la app o en el router, así no cambian.',
      external: true,
    },
    {
      title: 'Guarda y prueba',
      body: 'Al guardar, tus Kasa aparecen con su nombre. Prueba a encender y apagar: el enchufe o la luz responde al instante.',
    },
  ],
  fields: [
    {
      key: 'deviceIps',
      label: 'Direcciones de los Kasa (opcional)',
      help: 'Solo si no se descubren solos: las IP de tus Kasa separadas por comas, por ejemplo 192.168.1.60, 192.168.1.62. Déjalo vacío para el descubrimiento automático.',
      type: 'text',
      placeholder: '192.168.1.60, 192.168.1.62',
      required: false,
    },
  ],
  troubleshooting: [
    {
      q: 'No se descubren solos.',
      a: 'Suele pasar si tienes los aparatos inteligentes en otra red (VLAN). Añade sus direcciones IP a mano en el campo de arriba.',
    },
    {
      q: 'Tengo un Kasa que no responde.',
      a: 'Algunos modelos Kasa recientes han pasado a usar el mismo sistema que Tapo. Si un Kasa no responde, prueba a configurarlo como Tapo (con las credenciales de TP-Link y su IP).',
    },
  ],
};

const tapo: IntegrationGuide = {
  id: 'tapo',
  domain: 'iot',
  kind: 'tapo',
  category: 'plugs',
  displayName: 'TP-Link Tapo',
  vendor: 'TP-Link',
  icon: 'Plug',
  tier: 2,
  intro:
    'Los enchufes y focos Tapo de TP-Link (generación 3 en adelante, como el P100, P110 o L530) se controlan localmente, pero necesitan las credenciales de tu cuenta TP-Link para establecer una conexión segura con cada aparato. Tranquilo: aunque uses tu correo y contraseña, la comunicación es local; esos datos solo sirven para crear la llave de seguridad, no se sale a internet.',
  prerequisites: [
    'Enchufes o focos Tapo (generación 3+) configurados y conectados a tu WiFi.',
    'Las credenciales de tu cuenta TP-Link (el mismo correo y contraseña de la app Tapo).',
    'La IP de cada Tapo (conviene reservarla fija en el router).',
  ],
  steps: [
    {
      title: 'Reserva una IP fija a cada Tapo',
      body: 'El descubrimiento automático de los Tapo no es fiable, así que hay que indicar sus direcciones. Primero, en tu router, reserva una IP fija a cada Tapo para que no cambie con el tiempo. Anota esas direcciones.',
      external: true,
    },
    {
      title: 'Ten a mano tu cuenta TP-Link',
      body: 'Los Tapo exigen las credenciales de tu cuenta TP-Link (las mismas de la app Tapo) para negociar una conexión segura. Se usan de forma local para derivar la llave; no se envían a internet. Se guardan cifradas en tu servidor.',
      external: true,
    },
    {
      title: 'Conecta KrakenOS',
      body: 'Introduce tu correo y contraseña de TP-Link y las direcciones IP de tus Tapo, separadas por comas. Al guardar, los aparatos aparecen con su nombre y responden al instante.',
    },
  ],
  fields: [
    {
      key: 'email',
      label: 'Correo de tu cuenta TP-Link',
      help: 'El correo con el que entras a la app Tapo.',
      type: 'text',
      placeholder: 'tu-correo@ejemplo.com',
      required: true,
    },
    {
      key: 'password',
      label: 'Contraseña de TP-Link',
      help: 'La contraseña de tu cuenta TP-Link. Se usa localmente para crear la llave de seguridad y se guarda cifrada.',
      type: 'password',
      required: true,
      secret: true,
    },
    {
      key: 'deviceIps',
      label: 'Direcciones de los Tapo',
      help: 'Las IP de tus Tapo separadas por comas, por ejemplo 192.168.1.61, 192.168.1.63. Conviene que sean fijas.',
      type: 'text',
      placeholder: '192.168.1.61, 192.168.1.63',
      required: true,
    },
  ],
  troubleshooting: [
    {
      q: 'No encuentra los Tapo.',
      a: 'El descubrimiento automático de Tapo es poco fiable: asegúrate de escribir las direcciones IP a mano y de que sean correctas (mejor si están reservadas como fijas).',
    },
    {
      q: '¿Es seguro poner mi contraseña de TP-Link?',
      a: 'Sí. Se usa solo dentro de tu red para crear la llave de seguridad de cada aparato y se guarda cifrada. No se envía a internet.',
    },
    {
      q: '¿Veo el consumo eléctrico del P110?',
      a: 'De momento la integración cubre encendido/apagado, brillo y color. El consumo eléctrico todavía no se muestra.',
    },
  ],
};

const shelly: IntegrationGuide = {
  id: 'shelly',
  domain: 'iot',
  kind: 'shelly',
  category: 'plugs',
  displayName: 'Shelly',
  vendor: 'Shelly (Allterco)',
  icon: 'Plug',
  tier: 3,
  intro:
    'Shelly hace relés, enchufes y reguladores muy apreciados por su control 100% local. KrakenOS habla con ellos directamente por tu red, sin la nube. Como no hay un descubrimiento automático fiable, tendrás que introducir cada dispositivo con sus datos. A cambio, en los modelos con medición podrás ver hasta el consumo en vatios.',
  prerequisites: [
    'Dispositivos Shelly configurados y conectados a tu WiFi.',
    'La IP de cada Shelly (mejor si es fija). Recomendado: desactivar la nube en la app Shelly para un control 100% local.',
    'Saber la generación de cada uno (Gen1, o Gen2/Gen3) y si es un relé o una luz.',
  ],
  steps: [
    {
      title: 'Desactiva la nube y fija las IP (recomendado)',
      body: 'Para un control totalmente local, en la app Shelly o en la web de cada dispositivo desactiva la conexión a la nube. Aprovecha para reservar una IP fija a cada Shelly en tu router: la necesitarás para identificarlo.',
      external: true,
    },
    {
      title: 'Reúne los datos de cada dispositivo',
      body: 'De cada Shelly necesitas: su IP, un nombre, su generación (1 para los antiguos como Shelly 1/2.5/Plug S; 2 para los Plus/Pro/Mini), el número de canales o salidas que tiene, y si es un relé (enciende/apaga) o una luz (permite regular el brillo). Ten en cuenta que cada canal aparece como un dispositivo independiente.',
      external: true,
    },
    {
      title: 'Conecta KrakenOS',
      body: 'Introduce la lista de tus Shelly con esos datos. Al guardar, cada canal aparece por separado con su nombre, listo para encender y apagar; en los modelos con medición verás también el consumo.',
    },
  ],
  fields: [
    {
      key: 'devices',
      label: 'Lista de dispositivos Shelly',
      help: 'Un dispositivo por línea con su IP, nombre, generación (1 o 2), número de canales y tipo (relé o luz). El asistente te ayuda a rellenar cada uno; por dentro se guarda como una lista.',
      type: 'text',
      placeholder: '192.168.1.80 · Caldera · Gen1 · 1 canal · relé',
      required: true,
    },
  ],
  troubleshooting: [
    {
      q: '¿Por qué tengo que meterlos a mano?',
      a: 'Los Shelly no ofrecen un descubrimiento automático fiable en la red, así que hay que darles de alta uno a uno con su IP y sus datos.',
    },
    {
      q: 'Un Shelly con dos relés aparece dos veces.',
      a: 'Es lo esperado: cada canal o salida se muestra como un dispositivo independiente para que puedas controlarlos por separado.',
    },
    {
      q: 'No veo el consumo en vatios.',
      a: 'Solo los modelos con medición (1PM, 2.5, Plug S, Pro 4PM...) reportan vatios. Los que no la tienen no muestran consumo.',
    },
  ],
};

const meross: IntegrationGuide = {
  id: 'meross',
  domain: 'iot',
  kind: 'meross',
  category: 'plugs',
  displayName: 'Meross',
  vendor: 'Meross',
  icon: 'Plug',
  tier: 4,
  intro:
    'Los enchufes e interruptores Meross (MSS110, MSS310, regletas MSS425...) normalmente hablan con la nube de Meross. Para controlarlos de forma local hace falta un montaje algo avanzado: un "cartero" de mensajes (broker MQTT) en tu red y redirigir el tráfico de los Meross hacia él. Es la integración de enchufes con más pasos, pensada para quien busca independencia total de la nube.',
  prerequisites: [
    'Un broker MQTT (por ejemplo Mosquitto) instalado en tu servidor, escuchando en el puerto 1883.',
    'Poder redirigir el nombre "iot.meross.com" hacia tu broker (con Pi-hole, dnsmasq o el router).',
    'La clave (key) y el identificador (uuid) de cada Meross, que se obtienen una vez de tu cuenta Meross.',
  ],
  steps: [
    {
      title: 'Instala el broker MQTT',
      body: 'En tu servidor, instala un broker MQTT como Mosquitto y configúralo para escuchar en tu red (puerto 1883). El broker es el "cartero" por el que pasarán los mensajes de los Meross.',
      external: true,
    },
    {
      title: 'Redirige el DNS de Meross a tu broker',
      body: 'Los Meross intentan conectarse a "iot.meross.com". Hay que engañarlos para que en su lugar hablen con tu broker local. En Pi-hole o en tu router, crea una regla que apunte "iot.meross.com" a la IP de tu broker. Después, apaga y enciende cada Meross para que reconecte al broker local.',
      note: 'Ejemplo en Pi-hole/dnsmasq: address=/iot.meross.com/192.168.1.5',
      external: true,
    },
    {
      title: 'Obtén la clave de cada Meross',
      body: 'Cada Meross firma sus mensajes con una clave ligada a tu cuenta Meross. Se obtiene una vez (con herramientas tipo meross-cli usando tu usuario y contraseña de Meross). Anota el "uuid" y la "key" de cada dispositivo. La clave se guarda solo en tu servidor.',
      external: true,
    },
    {
      title: 'Conecta KrakenOS',
      body: 'Introduce la dirección y el puerto de tu broker, y la lista de tus Meross con su uuid, su clave y su nombre. Al guardar, los enchufes aparecen y responden a encender/apagar.',
    },
  ],
  fields: [
    {
      key: 'brokerHost',
      label: 'Dirección del broker MQTT',
      help: 'La IP de tu broker (Mosquitto) en la red, por ejemplo 192.168.1.5.',
      type: 'host',
      placeholder: '192.168.1.5',
      required: true,
    },
    {
      key: 'brokerPort',
      label: 'Puerto del broker',
      help: 'La "puerta" del broker MQTT. El habitual es 1883.',
      type: 'number',
      required: false,
      defaultValue: 1883,
    },
    {
      key: 'devices',
      label: 'Lista de dispositivos Meross',
      help: 'Un dispositivo por línea con su uuid, su clave (key) y un nombre. El asistente te ayuda a rellenar cada uno; por dentro se guarda como una lista. La clave se guarda cifrada.',
      type: 'text',
      placeholder: '2012... · Enchufe TV · (clave)',
      required: true,
    },
  ],
  troubleshooting: [
    {
      q: 'Los Meross siguen yendo a la nube.',
      a: 'La redirección de DNS no está haciendo efecto. Revisa la regla que apunta "iot.meross.com" a tu broker y reinicia (apaga y enciende) cada Meross para que reconecte.',
    },
    {
      q: 'No consigo la clave (key).',
      a: 'La clave se obtiene una sola vez de tu cuenta Meross con una herramienta de línea de comandos. Sin ella, los Meross no se pueden controlar localmente.',
    },
    {
      q: '¿Puedo ver el consumo o mover persianas?',
      a: 'Esta versión cubre encendido/apagado. El consumo (MSS310) y las persianas todavía no están disponibles.',
    },
  ],
};

const switchbot: IntegrationGuide = {
  id: 'switchbot',
  domain: 'iot',
  kind: 'switchbot',
  category: 'plugs',
  displayName: 'SwitchBot',
  vendor: 'SwitchBot',
  icon: 'Plug',
  tier: 2,
  intro:
    'SwitchBot tiene dispositivos muy versátiles: desde el "Bot" que pulsa físicamente un botón hasta enchufes y bombillas de colores. KrakenOS los controla a través del Hub Mini o Hub 2 de SwitchBot, usando su acceso local (sin la nube). Necesitas activar ese acceso en la app y copiar un "token" que hace de llave.',
  prerequisites: [
    'Un Hub Mini o Hub 2 de SwitchBot (los otros modelos de hub no sirven aquí).',
    'La app SwitchBot para activar el control local y obtener el token.',
    'Que el hub tenga una IP fija en tu router.',
  ],
  steps: [
    {
      title: 'Activa el control local en la app',
      body: 'Abre la app SwitchBot, entra en tu Hub Mini/Hub 2 y activa la opción de "API en LAN" o "control local" (el nombre varía según la versión). Asegúrate de que el hub tiene una IP fija reservada en tu router.',
      external: true,
    },
    {
      title: 'Copia el token',
      body: 'En la app SwitchBot, ve a "Perfil → Preferencias → Modo desarrollador" y copia el "Token". Es una llave larga que autoriza el acceso, como una contraseña. Guárdalo a mano para el siguiente paso.',
      note: 'Trata el token como una contraseña: no lo compartas. Se guarda cifrado.',
      external: true,
    },
    {
      title: 'Conecta KrakenOS',
      body: 'Introduce la dirección del hub, su puerto (por defecto 8123) y el token. Al guardar, aparecen los dispositivos compatibles (Bot, Plug Mini, bombillas de color, tiras...). Los sensores y cerraduras no se muestran en esta versión.',
    },
  ],
  fields: [
    {
      key: 'hubHost',
      label: 'Dirección del hub',
      help: 'La IP del Hub Mini/Hub 2 en tu red, por ejemplo 192.168.1.90. Conviene que sea fija.',
      type: 'host',
      placeholder: '192.168.1.90',
      required: true,
    },
    {
      key: 'hubPort',
      label: 'Puerto del hub',
      help: 'La "puerta" por la que responde el hub. Por defecto es 8123.',
      type: 'number',
      required: false,
      defaultValue: 8123,
    },
    {
      key: 'token',
      label: 'Token',
      help: 'La llave que copiaste del modo desarrollador de la app SwitchBot. Se guarda cifrada.',
      type: 'password',
      required: true,
      secret: true,
    },
  ],
  troubleshooting: [
    {
      q: 'No aparece ningún dispositivo.',
      a: 'Confirma que activaste el control local en el hub, que el token es correcto y que la dirección y el puerto del hub son los correctos. Recuerda que hace falta un Hub Mini o Hub 2.',
    },
    {
      q: 'No veo mi sensor o mi cerradura.',
      a: 'Esta versión solo muestra enchufes y luces (Bot, Plug Mini, Color Bulb, Strip Light, Ceiling Light). Los sensores, cortinas y cerraduras se filtran por ahora.',
    },
  ],
};

export const PLUG_GUIDES: IntegrationGuide[] = [kasa, tapo, shelly, meross, switchbot];
