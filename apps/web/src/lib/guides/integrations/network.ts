import type { IntegrationGuide } from '../types';

/**
 * Guías de red que no son "conectar un aparato" sino "acceder o usar una
 * función": VPN (WireGuard), DNS con bloqueo de anuncios (Pi-hole), cortafuegos
 * (iptables), VLAN y control de ancho de banda (QoS). Escritas desde cero en
 * español llano; las tres últimas son más "cómo se usa" que "cómo se conecta",
 * por eso no piden campos de configuración.
 */

const wireguard: IntegrationGuide = {
  id: 'wireguard',
  domain: 'vpn',
  kind: 'wireguard',
  category: 'remote-access',
  displayName: 'Acceso remoto (WireGuard)',
  vendor: 'WireGuard',
  icon: 'ShieldCheck',
  tier: 1,
  intro:
    'Con esto podrás entrar a tu casa desde fuera de forma segura: revisar KrakenOS, ver tus cámaras o controlar tus luces desde el móvil estés donde estés, como si estuvieras en el salón. Se usa una VPN (un túnel privado y cifrado) con la tecnología WireGuard. Lo mejor es que no tienes que entender nada técnico: KrakenOS genera la configuración y un código QR, y tú solo lo escaneas con una app.',
  prerequisites: [
    'La app gratuita "WireGuard" instalada en tu móvil o portátil (está en las tiendas de apps).',
    'Un nombre para identificar el dispositivo que vas a conectar (por ejemplo "Móvil de Ana").',
  ],
  steps: [
    {
      title: 'Ponle nombre al dispositivo',
      body: 'Escribe un nombre para reconocer el aparato que quieres conectar a la VPN, por ejemplo "Móvil de Ana" o "Portátil trabajo". Ese nombre es solo para ti, para distinguir cada acceso. KrakenOS se encarga del resto: crea toda la configuración por dentro.',
    },
    {
      title: 'Instala la app WireGuard',
      body: 'En el móvil o portátil que quieras conectar, instala la app oficial y gratuita de WireGuard desde la tienda de aplicaciones. Es la que abrirá el túnel seguro hacia tu casa.',
      external: true,
    },
    {
      title: 'Escanea el código QR',
      body: 'Al crear el acceso, KrakenOS te muestra un código QR. Abre la app WireGuard, elige "Añadir túnel → Escanear desde código QR" y apunta a la pantalla. La configuración se importa sola. Activa el túnel y ya estarás conectado a tu casa de forma segura.',
      note: 'El código QR contiene una llave privada: no lo compartas ni le hagas foto para enviárselo a nadie.',
      external: true,
    },
    {
      title: 'Comprueba la conexión',
      body: 'Con el túnel activado en la app WireGuard, prueba a abrir KrakenOS o a acceder a un aparato de casa. Deberías llegar como si estuvieras en tu propia red. Para dejar de usar la VPN, apaga el túnel en la app.',
    },
  ],
  fields: [
    {
      key: 'name',
      label: 'Nombre del dispositivo',
      help: 'Un nombre para reconocer este acceso, por ejemplo "Móvil de Ana". Solo sirve para que tú distingas cada dispositivo conectado.',
      type: 'text',
      placeholder: 'Móvil de Ana',
      required: true,
    },
  ],
  troubleshooting: [
    {
      q: 'Escaneo el QR pero no consigo conectar.',
      a: 'Asegúrate de haber activado el túnel en la app WireGuard (un interruptor). Comprueba también que tu casa es accesible desde fuera; si tu conexión de internet cambia de dirección a menudo, quizás necesites un nombre dinámico (DDNS).',
    },
    {
      q: '¿Es seguro? ¿Abro mi casa a internet?',
      a: 'Es de lo más seguro que hay. Solo quien tenga una configuración generada por ti (el QR) puede entrar por el túnel. No se expone ninguna pantalla ni aparato directamente a internet.',
    },
    {
      q: 'Quiero conectar otro dispositivo más.',
      a: 'Crea un acceso nuevo con otro nombre. Cada dispositivo (cada móvil, cada portátil) tiene su propia configuración y su propio QR.',
    },
  ],
};

const pihole: IntegrationGuide = {
  id: 'pihole',
  domain: 'dns',
  kind: 'pihole',
  category: 'ad-blocking',
  displayName: 'Bloqueo de anuncios (Pi-hole)',
  vendor: 'Pi-hole',
  icon: 'ShieldBan',
  tier: 2,
  intro:
    'Pi-hole es un pequeño servidor que bloquea anuncios y rastreadores para TODA tu casa a la vez, sin instalar nada en cada dispositivo. Funciona a través del DNS (la "agenda de contactos" de internet): cuando un aparato intenta cargar un anuncio, Pi-hole simplemente responde que ese sitio no existe. Si ya tienes un Pi-hole funcionando, KrakenOS puede conectarse a él para mostrarte estadísticas y gestionarlo.',
  prerequisites: [
    'Un Pi-hole ya instalado y funcionando en tu red (por ejemplo en una Raspberry Pi o en tu servidor).',
    'La dirección web del panel de Pi-hole.',
    'La contraseña del panel de Pi-hole, si tiene una (es opcional).',
  ],
  steps: [
    {
      title: 'Localiza la dirección de tu Pi-hole',
      body: 'Necesitas la dirección web del panel de administración de Pi-hole, que suele ser algo como http://192.168.1.5/admin. Es la misma que abres en el navegador para ver sus estadísticas.',
      external: true,
    },
    {
      title: 'Ten a mano la contraseña (si la tiene)',
      body: 'Pi-hole puede pedir una contraseña para entrar a su panel. Si la tuya la tiene, tenla a mano para el siguiente paso. Si tu Pi-hole no pide contraseña, puedes dejar ese campo vacío.',
      external: true,
    },
    {
      title: 'Conecta KrakenOS',
      body: 'Introduce la dirección de tu Pi-hole y, si hace falta, su contraseña. Al guardar, KrakenOS se conecta y podrás ver cuántas peticiones se están bloqueando y gestionar el filtrado desde aquí.',
    },
  ],
  fields: [
    {
      key: 'baseUrl',
      label: 'Dirección de Pi-hole',
      help: 'La dirección web del panel de Pi-hole, por ejemplo http://192.168.1.5/admin.',
      type: 'url',
      placeholder: 'http://192.168.1.5/admin',
      required: true,
    },
    {
      key: 'password',
      label: 'Contraseña (opcional)',
      help: 'La contraseña del panel de Pi-hole, si la tiene. Déjalo vacío si tu Pi-hole no pide contraseña. Se guarda cifrada.',
      type: 'password',
      required: false,
      secret: true,
    },
  ],
  troubleshooting: [
    {
      q: 'No conecta con Pi-hole.',
      a: 'Revisa que la dirección es correcta (incluida la parte /admin si aplica) y que el Pi-hole está encendido y accesible desde el servidor de KrakenOS. Si tiene contraseña, comprueba que es la correcta.',
    },
    {
      q: 'Conecta pero no bloquea anuncios en mis dispositivos.',
      a: 'Para que Pi-hole filtre, tus dispositivos (o tu router) deben usarlo como servidor DNS. Eso se configura en el router o en cada aparato; KrakenOS te muestra el estado, pero el DNS lo decide tu red.',
    },
  ],
};

const iptables: IntegrationGuide = {
  id: 'iptables',
  domain: 'firewall',
  kind: 'iptables',
  category: 'firewall',
  displayName: 'Cortafuegos (reglas)',
  icon: 'Flame',
  tier: 2,
  intro:
    'El cortafuegos (firewall) es el "portero" de tu red: decide qué comunicaciones se permiten y cuáles se bloquean. Con KrakenOS puedes crear reglas sencillas para, por ejemplo, impedir que un aparato hable con internet, o cerrar el paso a cierto tipo de conexiones. No hay nada que "conectar" aquí: es una función que ya viene incluida y que se usa desde la pantalla de Cortafuegos.',
  prerequisites: [
    'Un router o servidor gestionado por KrakenOS que aplique las reglas (se hace por debajo, de forma segura).',
    'Tener claro qué quieres permitir o bloquear (por ejemplo, "que la cámara no salga a internet").',
  ],
  steps: [
    {
      title: 'Entiende una regla',
      body: 'Una regla de cortafuegos dice, en el fondo: "para este tipo de tráfico, permítelo o bloquéalo". Puedes basarla en el aparato de origen, en el destino o en el tipo de conexión (el puerto y el protocolo). El orden importa: las reglas se revisan de arriba abajo y se aplica la primera que encaje.',
    },
    {
      title: 'Empieza por lo simple',
      body: 'Un uso muy típico y útil es impedir que un aparato dudoso (una cámara barata, un juguete inteligente) salga a internet, dejándole solo la red local. Otro es bloquear por completo a un dispositivo. Crea la regla desde la pantalla de Cortafuegos y observa el efecto.',
      note: 'Empieza con una sola regla y comprueba que hace lo que esperas antes de añadir más. Así es fácil saber qué hace cada una.',
    },
    {
      title: 'Revisa y ajusta',
      body: 'Tras crear una regla, prueba que el aparato afectado se comporta como querías (por ejemplo, que ya no llega a internet). Si algo deja de funcionar sin querer, desactiva la regla y vuelve a intentarlo con otro planteamiento.',
      warning: 'Ten cuidado de no bloquearte a ti mismo el acceso a KrakenOS o a internet. Si dudas, empieza por reglas que afecten a un solo aparato.',
    },
  ],
  fields: [],
  troubleshooting: [
    {
      q: 'Creé una regla y ahora algo no funciona.',
      a: 'Desactiva o borra la última regla que añadiste y comprueba si se arregla. Las reglas se aplican en orden, así que a veces una regla nueva "tapa" a otra. Ve de una en una.',
    },
    {
      q: '¿Qué es un "puerto" y un "protocolo"?',
      a: 'El puerto es como el número de puerta de un servicio dentro de una dirección (la web usa el 443, por ejemplo). El protocolo (TCP o UDP) es el idioma en que viajan los datos. En reglas sencillas no necesitas tocarlos.',
    },
  ],
};

const vlan: IntegrationGuide = {
  id: 'vlan',
  domain: 'vlan',
  kind: 'vlan',
  category: 'vlan',
  displayName: 'Redes separadas (VLAN)',
  icon: 'Network',
  tier: 3,
  intro:
    'Una VLAN te permite dividir tu red en zonas separadas usando el mismo router y el mismo cableado, como si pusieras tabiques dentro de tu casa. El uso más habitual: tener una zona para tus ordenadores y móviles, y otra aparte para los aparatos inteligentes (bombillas, cámaras, enchufes). Así, si uno de esos aparatos baratos tuviera un fallo de seguridad, no podría ver tus dispositivos personales.',
  prerequisites: [
    'Equipos de red que soporten VLAN (muchos routers y switches gestionables lo hacen).',
    'Una idea de qué zonas quieres crear (por ejemplo: "casa" y "aparatos inteligentes").',
  ],
  steps: [
    {
      title: 'Piensa en zonas',
      body: 'Antes de crear nada, decide qué zonas quieres. Lo más común son dos: una para tus dispositivos de confianza (ordenadores, móviles) y otra para los aparatos inteligentes y las visitas. Cada zona será una VLAN con su propio nombre.',
    },
    {
      title: 'Crea la VLAN',
      body: 'Desde la pantalla de VLAN, crea una nueva zona con un nombre claro (por ejemplo "IoT"). Por debajo, cada VLAN lleva un número identificador (una "etiqueta"). Puedes decidir si la zona queda aislada del resto, que es justo lo que interesa para los aparatos inteligentes.',
      note: 'La etiqueta es simplemente el número que identifica la VLAN dentro del equipo de red. No hace falta que signifique nada especial.',
    },
    {
      title: 'Asigna dispositivos y comprueba',
      body: 'Coloca cada aparato en su zona. A partir de ahí, los aparatos de una VLAN aislada tendrán internet pero no verán los de otras VLAN. Comprueba que todo lo que debe funcionar sigue funcionando (por ejemplo, controlar tus luces desde tu móvil puede requerir permitir esa comunicación entre zonas).',
      warning: 'Aislar por completo los aparatos inteligentes puede impedir que apps de tu móvil los "descubran". Si algo deja de aparecer, quizás haya que permitir un pequeño puente entre zonas.',
    },
  ],
  fields: [],
  troubleshooting: [
    {
      q: 'Puse mis luces en una VLAN aislada y ya no las controlo.',
      a: 'El aislamiento total corta también la comunicación entre tu móvil y las luces. Suele hacer falta permitir el "descubrimiento" (mDNS) o una regla concreta entre la zona de tu móvil y la de los aparatos.',
    },
    {
      q: '¿Necesito VLAN sí o sí?',
      a: 'No. Es una mejora de seguridad recomendable si tienes muchos aparatos inteligentes, pero tu red funciona perfectamente sin VLAN. Es un paso más avanzado.',
    },
  ],
};

const qos: IntegrationGuide = {
  id: 'qos',
  domain: 'qos',
  kind: 'tc',
  category: 'qos',
  displayName: 'Prioridad de internet (QoS)',
  icon: 'Gauge',
  tier: 2,
  intro:
    'QoS (Calidad de Servicio) sirve para repartir tu internet con cabeza. El ancho de banda es como la anchura de una tubería: si alguien se pone a descargar algo enorme, puede dejar sin conexión una videollamada o el vídeo de la tele. Con QoS le das prioridad a lo importante o pones un límite a lo que puede acaparar la conexión, para que todos naveguen con fluidez.',
  prerequisites: [
    'Un router o servidor gestionado por KrakenOS capaz de aplicar el control de tráfico.',
    'Saber, más o menos, qué velocidad de internet tienes contratada (ayuda a repartir bien).',
  ],
  steps: [
    {
      title: 'Identifica qué quieres proteger o limitar',
      body: 'Piensa qué actividades no deberían cortarse nunca (videollamadas, juegos online, la tele en directo) y qué aparatos o usos suelen "comerse" la conexión (descargas grandes, copias de seguridad). QoS trabaja dando prioridad a lo primero o frenando lo segundo.',
    },
    {
      title: 'Crea una regla de prioridad o de límite',
      body: 'Desde la pantalla de QoS, crea una regla: por ejemplo, dar prioridad al tráfico de videollamadas, o limitar la velocidad máxima de un aparato concreto. Empieza con una regla clara y observa el resultado en el día a día.',
      note: 'Si conoces tu velocidad contratada, indícala: QoS reparte mejor cuando sabe cuánta "tubería" hay en total.',
    },
    {
      title: 'Ajusta según la experiencia',
      body: 'Prueba durante unos días. Si notas que algo importante sigue cortándose, sube su prioridad o baja el límite del aparato que acapara. QoS es de afinar poco a poco hasta que la conexión se sienta fluida para todos.',
    },
  ],
  fields: [],
  troubleshooting: [
    {
      q: 'Activé QoS pero no noto diferencia.',
      a: 'QoS solo se nota cuando la conexión está saturada (varios usos a la vez). Si tienes de sobra, no verás cambios. Asegúrate también de haber indicado bien tu velocidad contratada.',
    },
    {
      q: '¿Me quita velocidad QoS?',
      a: 'No reduce tu velocidad total; solo la reparte mejor cuando hay competencia. Un pequeño margen puede reservarse para que la priorización funcione, pero el objetivo es que todo vaya más fluido, no más lento.',
    },
  ],
};

export const NETWORK_GUIDES: IntegrationGuide[] = [wireguard, pihole, iptables, vlan, qos];
