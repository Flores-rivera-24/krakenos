/**
 * Glosario de jerga de redes y domótica, en español llano (US-144).
 *
 * Cada entrada define un término en 1-2 frases para alguien que nunca ha oído
 * hablar de una dirección IP. `short` es la definición de una línea (ideal para
 * un tooltip); `long` amplía cuando ayuda. La clave es un slug estable que la UI
 * puede usar para enlazar una palabra a su definición.
 */

export interface GlossaryEntry {
  /** Término tal y como se muestra, p. ej. "Dirección IP". */
  term: string;
  /** Definición de una frase, apta para un tooltip. */
  short: string;
  /** Explicación más larga, opcional. */
  long?: string;
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  ssid: {
    term: 'SSID',
    short: 'Es el nombre de tu red WiFi, el que aparece en la lista cuando buscas WiFi en el móvil.',
    long: 'SSID significa "nombre de la red inalámbrica". Cuando cambias el nombre de tu WiFi, estás cambiando el SSID. Cada banda (2.4 y 5 GHz) puede tener el mismo nombre o uno distinto.',
  },
  'banda-24-5-6': {
    term: 'Banda 2.4 / 5 / 6 GHz',
    short: 'Son los "carriles" por los que viaja tu WiFi. La de 2.4 GHz llega más lejos; la de 5 y 6 GHz es más rápida pero de menor alcance.',
    long: 'Tu router puede emitir WiFi en varias frecuencias. La banda de 2.4 GHz atraviesa mejor las paredes y llega lejos, pero es más lenta y se satura fácil. Las de 5 y 6 GHz (esta última, en equipos WiFi 6E/7) son mucho más rápidas pero pierden fuerza a distancia.',
  },
  rssi: {
    term: 'RSSI / señal',
    short: 'La fuerza con la que un dispositivo recibe el WiFi. Se mide en dBm y siempre es un número negativo: cuanto más cerca de 0, mejor.',
    long: 'RSSI es la intensidad de la señal recibida. -50 dBm es una señal excelente (estás al lado del router), -70 dBm es aceptable y por debajo de -80 dBm la conexión va lenta o se corta. Es lo que colorea el mapa de calor de cobertura.',
  },
  dbm: {
    term: 'dBm',
    short: 'La unidad en la que se mide la fuerza del WiFi. Va en negativo: -50 es señal fuerte, -80 es señal débil.',
    long: 'El dBm mide la potencia de la señal. Como son valores muy pequeños, se expresan en negativo: -50 dBm es mucha más señal que -80 dBm (cada 10 dBm es 10 veces más/menos potencia).',
  },
  'mapa-calor-cobertura': {
    term: 'Mapa de calor de cobertura',
    short: 'Un dibujo de tu casa coloreado según la fuerza del WiFi en cada rincón: verde donde llega bien, rojo donde llega mal.',
    long: 'KrakenOS estima (o mide con tu móvil) la señal WiFi por toda la casa y la pinta sobre el plano: verde = señal excelente, amarillo = aceptable, rojo = débil o sin cobertura. Sirve para decidir dónde colocar el router o un punto de acceso extra.',
  },
  wpa2: {
    term: 'WPA2',
    short: 'Es el candado que protege tu WiFi con contraseña. Ha sido el estándar durante años y es seguro para la mayoría de hogares.',
    long: 'WPA2 cifra lo que viaja por tu WiFi para que nadie de fuera lo lea. Necesitas la contraseña para entrar. Su sucesor, WPA3, es aún más seguro.',
  },
  wpa3: {
    term: 'WPA3',
    short: 'La versión más nueva y segura del candado de tu WiFi. Si tus dispositivos la soportan, es la mejor opción.',
    long: 'WPA3 mejora a WPA2 protegiendo mejor la contraseña frente a intentos de adivinarla. Algunos dispositivos antiguos solo entienden WPA2, por eso muchos routers ofrecen un modo mixto WPA2/WPA3.',
  },
  'red-invitados': {
    term: 'Red de invitados',
    short: 'Una WiFi aparte para visitas y aparatos poco fiables, que no ve el resto de tus dispositivos de casa.',
    long: 'Al conectar a la red de invitados, alguien tiene internet pero no puede llegar a tu ordenador, tu NAS ni tus cámaras. Es ideal para las visitas y para separar los aparatos "inteligentes" del resto.',
  },
  'direccion-ip': {
    term: 'Dirección IP',
    short: 'Es el "número de teléfono" de un dispositivo dentro de tu red: sirve para que los aparatos se encuentren entre sí.',
    long: 'Cada móvil, ordenador o bombilla de tu casa tiene una dirección IP como 192.168.1.42. En casa suelen empezar por 192.168 o 10. Sin ella, dos aparatos no sabrían adónde enviarse los datos.',
  },
  mac: {
    term: 'Dirección MAC',
    short: 'Es el "número de serie" único de la tarjeta de red de un aparato, como aa:bb:cc:11:22:33.',
    long: 'A diferencia de la IP (que puede cambiar), la MAC viene grabada de fábrica en cada dispositivo. KrakenOS la usa para reconocer un aparato aunque cambie de IP, y para bloquearlo si hace falta.',
  },
  cidr: {
    term: 'CIDR / máscara de red',
    short: 'Una forma corta de decir "qué rango de direcciones IP forma una red", p. ej. 192.168.1.0/24.',
    long: 'El "/24" del final indica cuántas direcciones caben en la red. Un /24 son 256 direcciones (192.168.1.0 a 192.168.1.255), que es lo típico en casa. La máscara de red es otra manera de expresar lo mismo (255.255.255.0).',
  },
  subred: {
    term: 'Subred',
    short: 'Un grupo de dispositivos que comparten el mismo rango de direcciones IP y pueden hablarse directamente.',
    long: 'Tu casa suele ser una sola subred. Puedes dividirla en varias (por ejemplo, una para los aparatos inteligentes y otra para tus ordenadores) para que no se mezclen; ahí entran las VLAN.',
  },
  dhcp: {
    term: 'DHCP y "reserva de IP"',
    short: 'DHCP es el sistema que reparte direcciones IP automáticamente. La "reserva" fija una IP concreta a un aparato para que no cambie.',
    long: 'Cuando un dispositivo se conecta, el router le da una IP mediante DHCP. Esa IP puede cambiar con el tiempo. Una "reserva de IP" (o IP fija) le asigna siempre la misma, algo muy útil para cámaras, bombillas y enchufes que quieres localizar por su dirección.',
  },
  gateway: {
    term: 'Puerta de enlace (gateway)',
    short: 'Es la "puerta de salida" de tu red hacia internet: casi siempre, tu propio router.',
    long: 'Cuando un aparato quiere llegar a una web, envía el tráfico a la puerta de enlace, que lo saca a internet y trae la respuesta. En casa, la puerta de enlace es tu router (a menudo una IP como 192.168.1.1).',
  },
  vlan: {
    term: 'VLAN',
    short: 'Una forma de dividir tu red en zonas separadas usando el mismo cableado, como poner tabiques a una habitación grande.',
    long: 'Con VLAN puedes tener, por ejemplo, la zona "casa" y la zona "aparatos inteligentes" aisladas entre sí aunque usen el mismo router y switch. Así, si una bombilla barata tuviera un problema de seguridad, no vería tus ordenadores.',
  },
  dns: {
    term: 'DNS',
    short: 'Es la "agenda de contactos" de internet: traduce nombres como google.com al número (IP) del servidor.',
    long: 'Cuando escribes una dirección web, tu dispositivo pregunta al DNS por su IP, igual que buscarías un nombre en la agenda para obtener su número. Si cambias tu servidor DNS (por ejemplo, a Pi-hole), puedes filtrar anuncios y rastreadores.',
  },
  adblock: {
    term: 'Bloqueo de anuncios (ad-block por DNS)',
    short: 'Filtrar anuncios y rastreadores para toda la casa desde el propio DNS, sin instalar nada en cada dispositivo.',
    long: 'Un bloqueador por DNS como Pi-hole tiene una lista de dominios de publicidad y rastreo. Cuando un aparato intenta cargar uno, el DNS responde "no existe" y el anuncio no llega. Funciona en móviles, tele y consolas por igual.',
  },
  puerto: {
    term: 'Puerto',
    short: 'Es como el "número de puerta" dentro de una dirección IP: distingue qué servicio atiende (web, correo, cámara...).',
    long: 'Una misma IP puede ofrecer varios servicios a la vez, cada uno en su puerto. Por ejemplo, las webs suelen usar el puerto 443 y las cámaras RTSP el 554. Cuando el asistente te pide un puerto, casi siempre puedes dejar el que viene por defecto.',
  },
  protocolo: {
    term: 'Protocolo (TCP / UDP)',
    short: 'Son los dos "idiomas" en que viajan los datos por la red. TCP es cuidadoso y confirma la entrega; UDP es rápido y sin confirmación.',
    long: 'TCP se usa cuando importa que no se pierda nada (páginas web, archivos). UDP se usa cuando importa la rapidez y se toleran pérdidas (vídeo en directo, algunos aparatos inteligentes). No suele hacer falta elegirlo a mano.',
  },
  qos: {
    term: 'QoS / ancho de banda',
    short: 'El ancho de banda es la "anchura de la tubería" de internet. QoS reparte esa anchura para dar prioridad a lo que importa.',
    long: 'Si alguien descarga algo enorme, puede dejar sin conexión una videollamada. Con QoS (Calidad de Servicio) le das prioridad a la videollamada o limitas la descarga, para que la experiencia sea fluida para todos.',
  },
  vpn: {
    term: 'VPN',
    short: 'Un "túnel" privado y cifrado que te conecta a tu red de casa desde fuera, como si estuvieras en el salón.',
    long: 'Con una VPN, tu móvil se une a tu red doméstica de forma segura estés donde estés. Así accedes a KrakenOS y a tus dispositivos sin exponer nada a internet: nadie más puede entrar por ese túnel sin tu llave.',
  },
  wireguard: {
    term: 'WireGuard',
    short: 'La tecnología de VPN moderna, rápida y sencilla que usa KrakenOS para el acceso remoto.',
    long: 'WireGuard crea el túnel cifrado de la VPN. Instalas su app gratuita en el móvil, escaneas un código QR que genera KrakenOS, y listo: ya te conectas a casa de forma segura.',
  },
  rtsp: {
    term: 'RTSP',
    short: 'El "idioma" que hablan la mayoría de cámaras IP para emitir su vídeo en directo por la red local.',
    long: 'RTSP es una dirección especial (empieza por rtsp://) que apunta al vídeo de una cámara. KrakenOS la usa para tomar imágenes de la cámara sin depender de la nube del fabricante.',
  },
  'bridge-hue': {
    term: 'Bridge (puente Hue)',
    short: 'La cajita blanca de Philips Hue que conecta tus bombillas con la red. Sin ella, KrakenOS no las ve.',
    long: 'Las bombillas Hue no hablan WiFi: hablan con el bridge, y el bridge se conecta al router por cable. KrakenOS controla las luces a través de ese bridge, dentro de tu casa y sin pasar por internet.',
  },
  'local-key': {
    term: 'Local key (clave local de Tuya)',
    short: 'Una contraseña secreta y única de cada bombilla o enchufe Tuya, necesaria para controlarlo sin la nube.',
    long: 'Los dispositivos Tuya (muchos focos baratos de Amazon) cifran su comunicación local con esta clave. No aparece en la app: hay que obtenerla del portal de desarrollador de Tuya. Si vuelves a emparejar el aparato, la clave cambia.',
  },
  token: {
    term: 'Token',
    short: 'Una contraseña larga y automática que un servicio te da para que otras apps se identifiquen sin usar tu usuario y clave.',
    long: 'En vez de meter tu usuario y contraseña, algunos aparatos (como el hub de SwitchBot) te dan un token: una cadena de letras y números que autoriza el acceso. Trátalo como una contraseña y no lo compartas.',
  },
  ssh: {
    term: 'SSH',
    short: 'Una forma segura de darle órdenes por texto a un aparato de la red (un router, un servidor) desde otro.',
    long: 'SSH abre una "consola remota" cifrada. Algunos routers (OpenWrt, MikroTik, Cisco) permiten que KrakenOS los gestione por SSH con un usuario y contraseña. Es texto puro, sin ventanas.',
  },
  firmware: {
    term: 'Firmware',
    short: 'El programa interno que hace funcionar un aparato, como el sistema operativo de tu router o tu cámara.',
    long: 'El firmware es el "cerebro" de fábrica del dispositivo. A veces se actualiza para corregir fallos, y en algunos routers puedes cambiarlo por uno libre (como OpenWrt) que ofrece más control.',
  },
  controladora: {
    term: 'Controladora (controller)',
    short: 'Un programa o cajita central que gestiona todos los puntos de acceso y equipos de una marca (UniFi, Omada).',
    long: 'En sistemas como Ubiquiti UniFi o TP-Link Omada, no configuras cada antena por separado: hablas con una controladora central que las coordina. KrakenOS se conecta a esa controladora, no a cada equipo.',
  },
  'certificado-autofirmado': {
    term: 'Certificado autofirmado',
    short: 'Un certificado de seguridad que un aparato se crea a sí mismo, válido dentro de tu casa aunque el navegador avise de él.',
    long: 'Muchos equipos locales (routers, bridges, controladoras) usan HTTPS con un certificado que ellos mismos firman. El navegador desconfía porque no viene de una autoridad conocida, pero en tu propia red local es normal y seguro aceptarlo.',
  },
  mqtt: {
    term: 'MQTT / broker',
    short: 'Un sistema de "cartero" ligero que reparte mensajes entre aparatos inteligentes. El broker es la oficina de correos central.',
    long: 'Algunos dispositivos (Zigbee vía zigbee2mqtt, Meross) no hablan directamente con KrakenOS: dejan y recogen mensajes en un broker MQTT (como Mosquitto). KrakenOS se conecta a ese broker para enterarse de todo y dar órdenes.',
  },
  'application-key': {
    term: 'Application key (clave de aplicación)',
    short: 'Una llave que un aparato (como el bridge de Hue) te entrega la primera vez para que una app pueda controlarlo.',
    long: 'Para que KrakenOS controle tus luces Hue, el bridge tiene que darle permiso una vez. Pulsas el botón físico del bridge y él genera esta clave, que luego se guarda para no tener que repetir el permiso.',
  },
};

/** Devuelve la entrada del glosario por su clave, o undefined si no existe. */
export function getGlossaryEntry(key: string): GlossaryEntry | undefined {
  return GLOSSARY[key];
}

/** Lista todas las entradas del glosario ordenadas alfabéticamente por término. */
export function glossaryEntries(): (GlossaryEntry & { key: string })[] {
  return Object.entries(GLOSSARY)
    .map(([key, entry]) => ({ key, ...entry }))
    .sort((a, b) => a.term.localeCompare(b.term, 'es'));
}
