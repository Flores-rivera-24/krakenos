import type { IntegrationGuide } from '../types';

/**
 * Guías de enchufes e interruptores inteligentes (dominio 'iot', categoría 'plugs'):
 * Kasa, Tapo, Shelly y Meross. Internalizadas de sus docs y reescritas
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

/**
 * US-248: no es una marca, es la puerta abierta. Va en «Enchufes e interruptores»
 * porque es donde busca quien acaba de liberar un enchufe barato, que es el caso
 * de uso que la historia persigue.
 */
const mqttDiscovery: IntegrationGuide = {
  id: 'mqtt',
  domain: 'iot',
  kind: 'mqtt',
  category: 'plugs',
  displayName: 'Descubrimiento MQTT (ESPHome, Tasmota…)',
  icon: 'Radio',
  tier: 3,
  intro:
    'Esta no es la integración de una marca: es la puerta abierta. Muchos cacharros —los que llevan ESPHome o Tasmota, los enchufes baratos liberados con OpenBeken, tu red Z-Wave o tu zigbee2mqtt— saben anunciarse solos en una convención abierta. Si conectas KrakenOS a un broker MQTT de tu red, aparecen todos sin que nadie tenga que escribir un adaptador para tu modelo concreto.',
  prerequisites: [
    'Un broker MQTT en tu red (Mosquitto es el habitual): el "cartero" por el que pasan los mensajes. Sirve el mismo que ya uses para zigbee2mqtt.',
    'Tus aparatos configurados para publicar en él, con el anuncio automático activado.',
    'El paquete "mqtt" instalado en el servidor de KrakenOS (o haber instalado con la opción de dependencias extra).',
  ],
  steps: [
    {
      title: 'Ten un broker MQTT en casa',
      body: 'Los aparatos no hablan directamente con KrakenOS: dejan sus mensajes en un broker MQTT de tu red —el "cartero"— y KrakenOS los lee de ahí. Si ya tienes uno para zigbee2mqtt o para Meross, vale ese mismo.',
      external: true,
    },
    {
      title: 'Dile a cada aparato que se anuncie',
      body: 'En ESPHome, con el bloque "mqtt" en su configuración. En Tasmota, con un comando en su consola. En OpenBeken, con el botón de enviar el anuncio. En zigbee2mqtt y Z-Wave JS UI, activando su opción de anuncio automático.',
      command: 'Backlog MqttHost 192.168.1.10; MqttUser krakenos; MqttPassword TU_PASSWORD; SetOption19 1',
      note: 'El comando de ejemplo es el de Tasmota. Los pasos de cada firmware están en la guía completa.',
      external: true,
    },
    {
      title: 'Conecta KrakenOS al broker',
      body: 'Escribe abajo la dirección de tu broker MQTT y, si lo has protegido, su usuario y contraseña. Prueba la conexión y guarda.',
    },
    {
      title: 'Míralos aparecer',
      body: 'Los aparatos salen en «Dispositivos IoT» en segundos, con su nombre y su categoría. Un enchufe con medidor aparece como un enchufe con su lectura de consumo, no como dos cacharros distintos.',
      note: 'Si no aparece ninguno, casi siempre es que el aparato no está publicando su anuncio: revisa el paso 2.',
    },
  ],
  fields: [
    {
      key: 'brokerUrl',
      label: 'Dirección del broker MQTT',
      help: 'La dirección de tu broker MQTT en la red, con el puerto. Suele ser el 1883.',
      type: 'url',
      placeholder: 'mqtt://192.168.1.10:1883',
      required: true,
    },
    {
      key: 'discoveryPrefix',
      label: 'Prefijo del anuncio',
      help: 'Déjalo como está salvo que hayas cambiado el prefijo en tus aparatos. Se llama así porque es el nombre que le puso quien inventó la convención; KrakenOS no habla con Home Assistant para esto.',
      type: 'text',
      placeholder: 'homeassistant',
      required: false,
      defaultValue: 'homeassistant',
    },
    {
      key: 'username',
      label: 'Usuario (opcional)',
      help: 'Solo si tu broker pide usuario y contraseña.',
      type: 'text',
      required: false,
    },
    {
      key: 'password',
      label: 'Contraseña (opcional)',
      help: 'Solo si tu broker pide usuario y contraseña. Se guarda cifrada y no se vuelve a mostrar.',
      type: 'password',
      required: false,
      secret: true,
    },
  ],
  troubleshooting: [
    {
      q: 'No aparece ningún aparato.',
      a: 'Lo más probable es que no estén publicando su anuncio. Compruébalo desde el servidor con: mosquitto_sub -h TU_SERVIDOR -t \'homeassistant/#\' -v. Si ahí no sale nada, el problema está entre el aparato y el broker.',
    },
    {
      q: 'Aparece el aparato pero no su estado.',
      a: 'Algunos firmwares describen sus valores con una fórmula que KrakenOS no interpreta a propósito (sería ejecutar instrucciones que llegan por la red). El aparato se sigue viendo, pero esa lectura queda vacía. También puede ser que aún no haya publicado su estado: reinícialo.',
    },
    {
      q: 'Tengo una cerradura y no puedo abrirla desde la app.',
      a: 'Es deliberado: las cerraduras se leen pero no se abren desde KrakenOS mientras no esté decidida su política de seguridad. Un fallo en esa función abre la puerta de tu calle.',
    },
    {
      q: '¿Se van a duplicar mis aparatos si también uso Home Assistant?',
      a: 'No. KrakenOS ignora lo que publica él mismo, así que no se ingiere a sí mismo. Y lo que publique Home Assistant tampoco entra: aquí solo se leen los anuncios de los propios aparatos.',
    },
  ],
};

// US-242: la guía de SwitchBot se retira con su backend. Prometía «sin la app ni la
// nube» y en el paso 1 mandaba abrir la app — porque el backend pedía la API de
// NUBE v1.0 con el host cambiado por una IP de LAN. Un Hub 2 se integra por Matter,
// que sí funciona y no necesita adaptador propio.
export const PLUG_GUIDES: IntegrationGuide[] = [kasa, tapo, shelly, meross, mqttDiscovery];
