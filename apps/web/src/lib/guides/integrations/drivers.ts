import type { IntegrationGuide } from '../types';

/**
 * Guías de los drivers de router/switch (dominio 'driver', categoría 'router').
 * Internalizadas de los docs/*-setup.md y reescritas en español llano para el
 * asistente in-app. Las claves de `fields` coinciden EXACTAMENTE con la config
 * del backend por cada `kind`.
 */

const openwrt: IntegrationGuide = {
  id: 'openwrt',
  domain: 'driver',
  kind: 'openwrt',
  category: 'router',
  displayName: 'OpenWrt',
  vendor: 'OpenWrt (p. ej. TP-Link Archer AX21)',
  icon: 'Router',
  tier: 4,
  wifiSupported: true,
  intro:
    'OpenWrt es un sistema libre que puedes instalar en muchos routers para tener control total sobre ellos. Con él, KrakenOS puede ver todos los aparatos conectados a tu casa, bloquear los que no quieras y cambiar el nombre y la contraseña de tu WiFi, todo sin depender de ninguna nube. Es la opción más potente, pero también la que más manos requiere: hay que cambiar el programa interno del router.',
  prerequisites: [
    'Un router compatible con OpenWrt (por ejemplo, el TP-Link Archer AX21). Comprueba la etiqueta inferior: tiene que indicar una revisión de hardware soportada (por ejemplo "Ver: 1.0" o "Ver: 3.0").',
    'Un cable de red (Ethernet). El cambio de firmware SIEMPRE se hace por cable, nunca por WiFi.',
    'Algo de paciencia y calma: cambiar el firmware borra la configuración de fábrica del router.',
    'La dirección del router en tu red (te la damos más abajo) y una contraseña que tú elijas para él.',
  ],
  steps: [
    {
      title: 'Antes de nada: entiende el riesgo',
      body: 'Instalar OpenWrt reemplaza el programa de fábrica del router. Si usas el archivo equivocado para tu modelo, el router podría quedar inservible ("ladrillo") y perderías la garantía. No es lo habitual si vas con cuidado, pero conviene saberlo. Ve con calma y usa el archivo exacto de tu revisión.',
      warning: 'Descarga siempre el firmware para tu modelo Y tu revisión de hardware exactos. No te saltes este paso.',
      external: true,
    },
    {
      title: 'Descarga el firmware correcto',
      body: 'Entra en el selector oficial de firmware de OpenWrt, busca tu modelo (por ejemplo "Archer AX21") y elige tu revisión. Descarga la imagen que pone "factory": es la que acepta el router de fábrica la primera vez. La versión "sysupgrade" es solo para actualizar cuando ya tienes OpenWrt, no la uses ahora.',
      command: 'https://firmware-selector.openwrt.org/',
      external: true,
    },
    {
      title: 'Instala OpenWrt desde la web del router',
      body: 'Conecta tu ordenador por cable al router. Entra en su panel de administración de fábrica (en TP-Link suele ser http://192.168.0.1). Busca la opción de actualizar firmware manualmente (algo como "Advanced → System Tools → Firmware Upgrade → Local Upgrade"), sube el archivo "factory" que descargaste y confirma. El router se reiniciará en OpenWrt en 2-3 minutos.',
      warning: 'No desconectes la corriente durante el proceso, aunque parezca que tarda.',
      external: true,
    },
    {
      title: 'Primer arranque y contraseña',
      body: 'Tras instalar OpenWrt, el router pasa a responder en la dirección 192.168.1.1 (¡ojo, cambia respecto a la de fábrica!). Entra en http://192.168.1.1 con el navegador. La primera vez no hay contraseña: lo primero es ponerle una. Esa contraseña será la que uses aquí más abajo.',
      note: 'Anota bien la contraseña que le pongas al router: la necesitarás para conectar KrakenOS.',
      external: true,
    },
    {
      title: 'Enciende la WiFi (viene apagada)',
      body: 'OpenWrt arranca con la WiFi desactivada por seguridad. Actívala desde su panel web, en "Network → Wireless": enciende cada radio (una es de 2.4 GHz y otra de 5 GHz), ponle nombre a la red y una contraseña. A partir de ahí, KrakenOS ya podrá gestionar esa WiFi por ti.',
      external: true,
    },
    {
      title: 'Conecta KrakenOS',
      body: 'Rellena los datos de abajo con la dirección del router (192.168.1.1), el usuario (normalmente "root") y la contraseña que le pusiste. KrakenOS se conectará de forma segura y empezará a mostrar los aparatos de tu casa.',
    },
  ],
  fields: [
    {
      key: 'host',
      label: 'Dirección del router',
      help: 'La dirección IP del router en tu red. Tras instalar OpenWrt suele ser 192.168.1.1.',
      type: 'host',
      placeholder: '192.168.1.1',
      required: true,
    },
    {
      key: 'sshPort',
      label: 'Puerto de conexión',
      help: 'La "puerta" por la que KrakenOS habla con el router. Déjalo en 22 salvo que lo hayas cambiado a propósito.',
      type: 'number',
      required: false,
      defaultValue: 22,
    },
    {
      key: 'username',
      label: 'Usuario del router',
      help: 'El nombre de usuario administrador de OpenWrt. Casi siempre es "root".',
      type: 'text',
      placeholder: 'root',
      required: true,
    },
    {
      key: 'password',
      label: 'Contraseña del router',
      help: 'La contraseña que le pusiste a OpenWrt en el primer arranque. Se guarda cifrada.',
      type: 'password',
      required: true,
      secret: true,
    },
    {
      key: 'wanInterface',
      label: 'Interfaz de internet (WAN)',
      help: 'El "puerto" interno por el que el router recibe internet. En la mayoría de routers es "wan"; déjalo así si no sabes.',
      type: 'text',
      placeholder: 'wan',
      required: false,
      defaultValue: 'wan',
    },
    {
      key: 'guestNetwork',
      label: 'Red de invitados (opcional)',
      help: 'El nombre interno de la red de invitados en OpenWrt, si tienes una configurada. Puedes dejarlo en "guest".',
      type: 'text',
      placeholder: 'guest',
      required: false,
      defaultValue: 'guest',
    },
  ],
  troubleshooting: [
    {
      q: 'No aparece ningún dispositivo en el inventario.',
      a: 'Comprueba que la dirección, el usuario y la contraseña son correctos, y que el router responde en esa IP. La primera vez, la conexión te pedirá aceptar la "huella" del router: acéptala.',
    },
    {
      q: 'Cambio el nombre de la WiFi y no se aplica.',
      a: 'Asegúrate de que activaste la radio correspondiente en OpenWrt y de que el usuario que usas es administrador ("root" lo es). Revisa que la WiFi no esté apagada en el router.',
    },
    {
      q: '¿Es seguro usar la contraseña en vez de una clave?',
      a: 'Sí, siempre que tu servidor de KrakenOS esté en tu red de confianza. Para instalaciones más avanzadas se puede usar una clave SSH, pero para empezar la contraseña es suficiente.',
    },
  ],
};

const asus: IntegrationGuide = {
  id: 'asus',
  domain: 'driver',
  kind: 'asus',
  category: 'router',
  displayName: 'ASUS',
  vendor: 'ASUS / Asuswrt-Merlin',
  icon: 'Router',
  tier: 2,
  wifiSupported: true,
  intro:
    'Si tienes un router ASUS (como los RT-AX88U, RT-AX86U, ZenWiFi o TUF Gaming), KrakenOS puede conectarse a él usando el mismo panel de administración que abres en el navegador. Podrás ver quién está conectado, bloquear aparatos y cambiar tu WiFi. Funciona tanto con el firmware original de ASUS como con el popular Asuswrt-Merlin. No hay que instalar nada raro: solo activar el acceso local y darnos el usuario y la contraseña del router.',
  prerequisites: [
    'Un router ASUS conectado a tu red.',
    'El usuario y la contraseña de administración del router (los mismos con los que entras a su panel).',
    'Tener el acceso web local del router activado (te explicamos cómo).',
  ],
  steps: [
    {
      title: 'Activa el acceso local del router',
      body: 'Entra al panel del router ASUS desde el navegador y ve a "Administration → System". En "Local Access Config" asegúrate de que el acceso web por la red local está permitido. Si prefieres que use HTTPS (conexión cifrada), actívalo aquí y marca la casilla de HTTPS más abajo.',
      external: true,
    },
    {
      title: 'Apunta usuario y contraseña',
      body: 'Necesitas el nombre de usuario y la contraseña de administración del router. Son los mismos que usas para entrar a su panel de configuración. Si nunca los cambiaste, míralos en la etiqueta del router.',
      external: true,
    },
    {
      title: 'Revisa el filtro de MAC (importante para bloquear)',
      body: 'El bloqueo de aparatos en routers ASUS usa el "filtro de direcciones MAC" del router. Para que funcione bien, ese filtro debe estar en modo "lista negra" (bloquear los de la lista), no en modo "lista blanca" (permitir solo los de la lista). Lo revisas en "Firewall → MAC filter". Si lo tienes en lista blanca, mejor no uses el bloqueo desde KrakenOS.',
      note: 'La MAC es el número de serie único de cada aparato. KrakenOS la usa para saber a quién bloquear.',
      external: true,
    },
    {
      title: 'Conecta KrakenOS',
      body: 'Rellena la dirección del router (normalmente 192.168.1.1), el usuario y la contraseña. Si activaste HTTPS en el paso 1, marca esa casilla. Al guardar, verás los aparatos conectados y tu WiFi de 2.4 y 5 GHz.',
    },
  ],
  fields: [
    {
      key: 'host',
      label: 'Dirección del router',
      help: 'La dirección IP del router ASUS en tu red. Lo más habitual es 192.168.1.1.',
      type: 'host',
      placeholder: '192.168.1.1',
      required: true,
    },
    {
      key: 'username',
      label: 'Usuario de administración',
      help: 'El usuario con el que entras al panel del router. Suele ser "admin".',
      type: 'text',
      placeholder: 'admin',
      required: true,
    },
    {
      key: 'password',
      label: 'Contraseña de administración',
      help: 'La contraseña de administración del router. Se guarda cifrada y no se vuelve a mostrar.',
      type: 'password',
      required: true,
      secret: true,
    },
    {
      key: 'https',
      label: 'El router usa HTTPS',
      help: 'Actívalo solo si en el paso 1 pusiste el panel del router en HTTPS (conexión cifrada). Si no, déjalo desactivado.',
      type: 'boolean',
      required: false,
      defaultValue: false,
    },
  ],
  troubleshooting: [
    {
      q: 'Bloqueo un aparato pero sigue conectado.',
      a: 'Comprueba que el filtro de MAC del router está en modo "lista negra" (deny). En modo "lista blanca" el bloqueo no funciona como esperas.',
    },
    {
      q: 'No veo el tráfico de cada aparato por separado.',
      a: 'Es normal: los routers ASUS solo informan del consumo total de internet, no por dispositivo. Verás la velocidad general, no un desglose por aparato.',
    },
    {
      q: 'No encuentro la red de invitados.',
      a: 'La red de invitados de ASUS se gestiona desde el panel del propio router; KrakenOS no la modifica en esta versión.',
    },
  ],
};

const unifi: IntegrationGuide = {
  id: 'unifi',
  domain: 'driver',
  kind: 'unifi',
  category: 'router',
  displayName: 'Ubiquiti UniFi',
  vendor: 'Ubiquiti',
  icon: 'Network',
  tier: 2,
  wifiSupported: true,
  intro:
    'Si tienes equipos Ubiquiti UniFi (un Dream Machine, un Cloud Key o la aplicación UniFi Network en un PC), KrakenOS habla directamente con tu controladora dentro de casa, sin pasar por la nube de Ubiquiti. Verás los aparatos conectados, podrás bloquearlos y cambiar tus redes WiFi. Solo necesitas crear una cuenta local en la controladora y darnos sus datos.',
  prerequisites: [
    'Una controladora UniFi funcionando (Dream Machine/Router, Cloud Key o la app UniFi Network autoalojada).',
    'La dirección web de la controladora (te damos ejemplos abajo).',
    'Permiso para crear una cuenta de administrador local en ella.',
  ],
  steps: [
    {
      title: 'Localiza la dirección de tu controladora',
      body: 'Si tienes un equipo UniFi OS (Dream Machine, Cloud Key Gen2), la dirección suele ser https://192.168.1.1. Si usas la aplicación UniFi Network instalada en un ordenador o servidor, suele ser https://la-ip-del-servidor:8443. Esa dirección completa es la que pondrás abajo.',
      external: true,
    },
    {
      title: 'Crea una cuenta LOCAL (no la de la nube)',
      body: 'La cuenta de Ubiquiti que usas en la app del móvil (la de la nube) no sirve aquí. Entra en la controladora como administrador y ve a "Settings → Admins" (o "Admins & Users"). Crea un administrador nuevo marcando la opción "Restrict to local access only" (solo acceso local). Ponle usuario y contraseña.',
      note: 'Para ver aparatos basta con permiso de lectura; para bloquear y cambiar la WiFi necesita permiso de escritura sobre la red.',
      external: true,
    },
    {
      title: 'Elige el site (si tienes varios)',
      body: 'UniFi organiza las redes en "sites". Si solo tienes tu casa, será "default" y no tienes que tocar nada. Si gestionas varias ubicaciones, indica el nombre del site que controla tu casa.',
      external: true,
    },
    {
      title: 'Conecta KrakenOS',
      body: 'Introduce la dirección de la controladora, el usuario y la contraseña de la cuenta local que creaste, y el site. KrakenOS aceptará el certificado local de la controladora automáticamente. Al guardar, verás tu inventario y tus redes WiFi.',
    },
  ],
  fields: [
    {
      key: 'url',
      label: 'Dirección de la controladora',
      help: 'La dirección web completa, con https://. Por ejemplo https://192.168.1.1 o https://192.168.1.10:8443.',
      type: 'url',
      placeholder: 'https://192.168.1.1',
      required: true,
    },
    {
      key: 'username',
      label: 'Usuario local',
      help: 'El usuario de la cuenta local que creaste en la controladora (no el de la nube de Ubiquiti).',
      type: 'text',
      placeholder: 'krakenos',
      required: true,
    },
    {
      key: 'password',
      label: 'Contraseña',
      help: 'La contraseña de esa cuenta local. Se guarda cifrada.',
      type: 'password',
      required: true,
      secret: true,
    },
    {
      key: 'site',
      label: 'Site',
      help: 'El nombre del site de UniFi que gestiona tu casa. Si solo tienes uno, déjalo en "default".',
      type: 'text',
      placeholder: 'default',
      required: false,
      defaultValue: 'default',
    },
  ],
  troubleshooting: [
    {
      q: 'Me da error al iniciar sesión.',
      a: 'Asegúrate de usar la cuenta LOCAL (creada con "Restrict to local access only"), no tu cuenta de la nube de Ubiquiti. Revisa también que la dirección incluye https:// y el puerto correcto.',
    },
    {
      q: 'El navegador o el sistema avisa de un certificado no fiable.',
      a: 'Es normal: la controladora usa un certificado hecho por ella misma para tu red local. KrakenOS lo acepta automáticamente porque es una conexión dentro de tu casa.',
    },
    {
      q: 'No veo el consumo por dispositivo.',
      a: 'UniFi, a través de esta conexión, solo reporta la velocidad total de internet, no el desglose por aparato.',
    },
  ],
};

const omada: IntegrationGuide = {
  id: 'omada',
  domain: 'driver',
  kind: 'omada',
  category: 'router',
  displayName: 'TP-Link Omada',
  vendor: 'TP-Link',
  icon: 'Network',
  tier: 2,
  wifiSupported: true,
  intro:
    'Omada es el sistema profesional de TP-Link para gestionar puntos de acceso, switches y routers desde una controladora central (puede ser un programa en un PC o una cajita OC200/OC300). KrakenOS se conecta a esa controladora dentro de tu red para ver los aparatos conectados, bloquearlos y cambiar tus WiFi. Solo usa la controladora local, nunca la nube de Omada.',
  prerequisites: [
    'Una controladora Omada funcionando en tu red (software en un PC/Docker, o un OC200/OC300).',
    'Los puntos de acceso deben estar gestionados por la controladora (no en modo suelto/standalone).',
    'Poder crear una cuenta de administrador local en la controladora.',
  ],
  steps: [
    {
      title: 'Localiza la dirección de la controladora',
      body: 'La versión software (v5) suele responder en https://la-ip:8043. Los equipos OC200/OC300 suelen usar https://la-ip:443. Esa dirección completa es la que pondrás abajo.',
      external: true,
    },
    {
      title: 'Crea una cuenta de administrador local',
      body: 'Entra en la controladora como administrador y ve a "Settings → Admin" (o "Account"). Crea un administrador local (no la cuenta de la nube de TP-Link) con permiso sobre el site que gestiona tu casa. Ese usuario y contraseña son los que usarás aquí.',
      external: true,
    },
    {
      title: 'Confirma el nombre del site',
      body: 'Omada organiza la red en "sites". El nombre por defecto suele ser "Default". Escríbelo tal cual aparece en la controladora (respeta mayúsculas). El identificador interno de la controladora se detecta solo, así que puedes dejar ese campo vacío.',
      external: true,
    },
    {
      title: 'Conecta KrakenOS',
      body: 'Introduce la dirección de la controladora, el usuario y la contraseña locales, y el nombre del site. Al guardar, verás los aparatos conectados y las WiFi del site.',
    },
  ],
  fields: [
    {
      key: 'url',
      label: 'Dirección de la controladora',
      help: 'La dirección web completa con https://. Por ejemplo https://192.168.1.10:8043 (software) o https://192.168.1.10:443 (OC200/OC300).',
      type: 'url',
      placeholder: 'https://192.168.1.10:8043',
      required: true,
    },
    {
      key: 'username',
      label: 'Usuario local',
      help: 'El usuario de la cuenta de administrador local de la controladora (no el de la nube de TP-Link).',
      type: 'text',
      placeholder: 'krakenos',
      required: true,
    },
    {
      key: 'password',
      label: 'Contraseña',
      help: 'La contraseña de esa cuenta local. Se guarda cifrada.',
      type: 'password',
      required: true,
      secret: true,
    },
    {
      key: 'siteName',
      label: 'Nombre del site',
      help: 'El nombre exacto del site en Omada (respeta mayúsculas). Por defecto suele ser "Default".',
      type: 'text',
      placeholder: 'Default',
      required: false,
      defaultValue: 'Default',
    },
    {
      key: 'omadacId',
      label: 'ID de la controladora (opcional)',
      help: 'Un identificador interno de la controladora. Déjalo vacío: KrakenOS lo detecta automáticamente.',
      type: 'text',
      required: false,
    },
  ],
  troubleshooting: [
    {
      q: 'No encuentra mi site.',
      a: 'Escribe el nombre del site exactamente como aparece en la controladora, respetando mayúsculas y minúsculas (por defecto "Default").',
    },
    {
      q: 'Los puntos de acceso no aparecen.',
      a: 'Deben estar "adoptados" por la controladora Omada. Los APs en modo suelto (standalone) no funcionan con esta conexión.',
    },
    {
      q: 'Falla al cambiar una WiFi.',
      a: 'Algunas versiones de la controladora usan rutas distintas para las WiFi. Revisa que tu usuario tiene permiso de escritura sobre el site.',
    },
  ],
};

const mikrotik: IntegrationGuide = {
  id: 'mikrotik',
  domain: 'driver',
  kind: 'mikrotik',
  category: 'router',
  displayName: 'MikroTik RouterOS',
  vendor: 'MikroTik',
  icon: 'Router',
  tier: 3,
  wifiSupported: true,
  intro:
    'MikroTik hace routers muy potentes (hEX, RB4011, CRS, CCR y más) que funcionan con un sistema llamado RouterOS. KrakenOS puede gestionarlos de dos maneras: la moderna (API REST, para RouterOS 7) o la clásica (por SSH, para RouterOS 6). Podrás ver los aparatos conectados, bloquearlos y, si tu MikroTik tiene WiFi, gestionarla. Requiere activar una opción en el router y crear un usuario.',
  prerequisites: [
    'Un router MikroTik en tu red y acceso de administrador a él.',
    'Saber si tu RouterOS es la versión 7 (usa el modo REST) o la 6 (usa el modo SSH).',
    'Poder crear un usuario con permisos en el router.',
  ],
  steps: [
    {
      title: 'Elige el modo según tu versión',
      body: 'Si tu router tiene RouterOS 7 (lo habitual hoy), usa el modo "REST", que es más sencillo. Si tiene RouterOS 6, usa el modo "SSH". Puedes ver tu versión en el panel del router.',
      external: true,
    },
    {
      title: 'Modo REST: activa el servicio web',
      body: 'En RouterOS 7, activa el servicio web seguro para que la API responda. Desde el terminal del router ejecuta el comando de abajo y comprueba que "www-ssl" (o "www") aparece activo.',
      command: '/ip service enable www-ssl\n/ip service print',
      external: true,
    },
    {
      title: 'Modo SSH: activa SSH',
      body: 'Si vas a usar el modo SSH (RouterOS 6), activa el acceso SSH en el router con el comando de abajo. En este modo, KrakenOS traduce sus acciones a comandos del router.',
      command: '/ip service enable ssh',
      external: true,
    },
    {
      title: 'Crea un usuario con permisos',
      body: 'En vez de usar el "admin", crea un usuario dedicado para KrakenOS. Con permiso de lectura basta para ver aparatos y tráfico; añade permiso de escritura si quieres bloquear aparatos y cambiar la WiFi.',
      command:
        '/user group add name=krakenos policy=read,write,api,rest-api,!ftp,!telnet\n/user add name=krakenos group=krakenos password=TU_CONTRASEÑA',
      external: true,
    },
    {
      title: 'Conecta KrakenOS',
      body: 'Elige el modo (REST o SSH), pon la dirección del router (a menudo 192.168.88.1), el usuario y la contraseña que creaste, y el nombre del puerto de internet (WAN) de tu router. Al guardar, verás el inventario.',
    },
  ],
  fields: [
    {
      key: 'mode',
      label: 'Modo de conexión',
      help: 'REST para RouterOS 7 (recomendado). SSH para RouterOS 6 o si el REST no está disponible.',
      type: 'select',
      required: true,
      defaultValue: 'rest',
      options: [
        { value: 'rest', label: 'REST (RouterOS 7)' },
        { value: 'ssh', label: 'SSH (RouterOS 6)' },
      ],
    },
    {
      key: 'host',
      label: 'Dirección del router',
      help: 'La dirección IP del MikroTik en tu red. Por defecto de fábrica suele ser 192.168.88.1.',
      type: 'host',
      placeholder: '192.168.88.1',
      required: true,
    },
    {
      key: 'username',
      label: 'Usuario',
      help: 'El usuario que creaste para KrakenOS en el router.',
      type: 'text',
      placeholder: 'krakenos',
      required: true,
    },
    {
      key: 'password',
      label: 'Contraseña',
      help: 'La contraseña de ese usuario. Se guarda cifrada.',
      type: 'password',
      required: true,
      secret: true,
    },
    {
      key: 'wanInterface',
      label: 'Puerto de internet (WAN)',
      help: 'El nombre de la interfaz por la que entra internet, para medir el tráfico. En muchos MikroTik es "ether1"; ajústalo a tu router.',
      type: 'text',
      placeholder: 'ether1',
      required: false,
      defaultValue: 'ether1',
    },
    {
      key: 'https',
      label: 'Usar conexión cifrada (HTTPS)',
      help: 'Solo en modo REST. Déjalo activado salvo que tu router solo tenga el servicio "www" sin cifrar.',
      type: 'boolean',
      required: false,
      defaultValue: true,
    },
    {
      key: 'sshPort',
      label: 'Puerto SSH',
      help: 'Solo en modo SSH. La puerta por la que se conecta; normalmente 22.',
      type: 'number',
      required: false,
      defaultValue: 22,
    },
  ],
  troubleshooting: [
    {
      q: 'No conecta en modo REST.',
      a: 'Comprueba que activaste el servicio "www-ssl" (o "www") y que tu RouterOS es la versión 7. Si tu router solo tiene "www" sin cifrar, desactiva la casilla de HTTPS.',
    },
    {
      q: 'Las opciones de WiFi dan error.',
      a: 'Solo los MikroTik con WiFi integrada la soportan. Modelos como hEX, RB4011, CRS o CCR no tienen radio, así que no aparecen como punto de acceso.',
    },
    {
      q: 'Bloqueo un aparato y quiero deshacerlo.',
      a: 'Al desbloquear, KrakenOS quita la entrada del aparato de la lista de bloqueados. La regla general de bloqueo permanece en el router, lista para futuros bloqueos.',
    },
  ],
};

const pfsense: IntegrationGuide = {
  id: 'pfsense',
  domain: 'driver',
  kind: 'pfsense',
  category: 'router',
  displayName: 'pfSense',
  vendor: 'Netgate',
  icon: 'Router',
  tier: 3,
  wifiSupported: false,
  intro:
    'pfSense es un firewall y router muy completo que mucha gente instala en un mini-PC para gobernar su red. KrakenOS se conecta a él por su API para ver los aparatos conectados y bloquear los que quieras. Como pfSense es un router-firewall (no un punto de acceso), la gestión de la WiFi no aplica: eso lo llevan tus antenas aparte.',
  prerequisites: [
    'Un pfSense funcionando en tu red, con acceso de administrador.',
    'El paquete de API REST instalado y habilitado en pfSense (versión 2), que permite crear una clave de acceso.',
    'La dirección web de tu pfSense.',
  ],
  steps: [
    {
      title: 'Activa la API en pfSense',
      body: 'En el panel de pfSense, instala/activa el paquete de API REST (v2) y habilítalo. Es lo que permite que otras apps, como KrakenOS, se conecten de forma controlada.',
      external: true,
    },
    {
      title: 'Genera una clave de acceso (API key)',
      body: 'Dentro de la configuración de la API, crea una clave para KrakenOS. Una clave API es como una contraseña larga que identifica a la app sin usar tu usuario personal. Cópiala en cuanto la generes: por seguridad, a veces solo se muestra una vez.',
      note: 'Trata la clave como una contraseña: no la compartas. Se guardará cifrada.',
      external: true,
    },
    {
      title: 'Conecta KrakenOS',
      body: 'Pon la dirección web de tu pfSense y la clave de acceso. Indica también cuál es el puerto de internet (WAN) y el de tu red local (LAN); en la mayoría de instalaciones son "wan" y "lan". Al guardar, verás el inventario de aparatos.',
    },
  ],
  fields: [
    {
      key: 'baseUrl',
      label: 'Dirección de pfSense',
      help: 'La dirección web de tu pfSense, con https://. Por ejemplo https://192.168.1.1.',
      type: 'url',
      placeholder: 'https://192.168.1.1',
      required: true,
    },
    {
      key: 'apiKey',
      label: 'Clave de acceso (API key)',
      help: 'La clave que generaste en la configuración de la API de pfSense. Se guarda cifrada y no se vuelve a mostrar.',
      type: 'password',
      required: true,
      secret: true,
    },
    {
      key: 'wanInterface',
      label: 'Interfaz de internet (WAN)',
      help: 'El nombre de la interfaz por la que entra internet. En pfSense suele ser "wan".',
      type: 'text',
      placeholder: 'wan',
      required: false,
      defaultValue: 'wan',
    },
    {
      key: 'lanInterface',
      label: 'Interfaz de red local (LAN)',
      help: 'El nombre de la interfaz de tu red interna. En pfSense suele ser "lan".',
      type: 'text',
      placeholder: 'lan',
      required: false,
      defaultValue: 'lan',
    },
  ],
  troubleshooting: [
    {
      q: 'La conexión es rechazada.',
      a: 'Comprueba que el paquete de API está instalado y habilitado, que la dirección incluye https:// y que la clave de acceso es correcta y no ha caducado.',
    },
    {
      q: '¿Puedo gestionar la WiFi desde aquí?',
      a: 'No. pfSense es un router-firewall, no un punto de acceso WiFi. Tus antenas WiFi se gestionan por su cuenta; esta integración cubre inventario y bloqueo.',
    },
  ],
};

const ciscoIos: IntegrationGuide = {
  id: 'cisco-ios',
  domain: 'driver',
  kind: 'cisco-ios',
  category: 'router',
  displayName: 'Cisco IOS',
  vendor: 'Cisco (Catalyst)',
  icon: 'Network',
  tier: 4,
  wifiSupported: false,
  intro:
    'Si tienes un switch o router Cisco de la familia Catalyst (2960, 3560, 9000, etc.) con el sistema IOS clásico, KrakenOS puede conectarse a él por SSH para ver los aparatos conectados y bloquear los que quieras. Es una opción para equipos profesionales; requiere preparar el switch con unos comandos. Los switches Cisco no tienen WiFi, así que esa parte no aplica.',
  prerequisites: [
    'Un switch o router Cisco con IOS y SSH habilitado.',
    'Un usuario con permisos para consultar y, si vas a bloquear, para entrar en modo configuración.',
    'Que el servidor de KrakenOS pueda alcanzar el equipo por SSH (normalmente el puerto 22).',
    'No sirve para Cisco Meraki (solo se gestiona por nube) ni para la gama Small Business (sin IOS).',
  ],
  steps: [
    {
      title: 'Habilita SSH en el switch',
      body: 'Desde la consola del equipo, entra en modo configuración y activa SSH creando un usuario administrador y las claves. El bloque de comandos de abajo hace justo eso; cambia "TU_PASSWORD" por una contraseña segura y guarda al final.',
      command:
        'enable\nconfigure terminal\n hostname SW1\n ip domain-name casa.local\n crypto key generate rsa modulus 2048\n username admin privilege 15 secret TU_PASSWORD\n line vty 0 4\n  transport input ssh\n  login local\n ip ssh version 2\nend\nwrite memory',
      external: true,
    },
    {
      title: 'Contraseña de "enable" (si la usas)',
      body: 'Algunos equipos piden una segunda contraseña para pasar a modo administrador (el modo "enable"). Si tu switch la tiene, tenla a mano: la introducirás en el campo correspondiente más abajo.',
      external: true,
    },
    {
      title: 'Conecta KrakenOS',
      body: 'Pon la dirección del switch, el usuario y la contraseña de SSH, y si hace falta la contraseña de "enable". Indica la interfaz por la que quieres medir el tráfico (por ejemplo GigabitEthernet0/0). Al guardar, el inventario se llena con los aparatos que ve el switch.',
    },
  ],
  fields: [
    {
      key: 'host',
      label: 'Dirección del switch',
      help: 'La dirección IP del switch o router Cisco en tu red.',
      type: 'host',
      placeholder: '192.168.1.254',
      required: true,
    },
    {
      key: 'sshPort',
      label: 'Puerto SSH',
      help: 'La puerta por la que KrakenOS se conecta por SSH. Normalmente 22.',
      type: 'number',
      required: false,
      defaultValue: 22,
    },
    {
      key: 'username',
      label: 'Usuario',
      help: 'El usuario administrador que creaste para SSH.',
      type: 'text',
      placeholder: 'admin',
      required: true,
    },
    {
      key: 'password',
      label: 'Contraseña',
      help: 'La contraseña de ese usuario SSH. Se guarda cifrada.',
      type: 'password',
      required: true,
      secret: true,
    },
    {
      key: 'enablePassword',
      label: 'Contraseña de "enable" (opcional)',
      help: 'Solo si tu equipo pide una segunda contraseña para el modo administrador. Si no la usas, déjalo vacío.',
      type: 'password',
      required: false,
      secret: true,
    },
    {
      key: 'interface',
      label: 'Interfaz de tráfico',
      help: 'El nombre de la interfaz por la que quieres medir el tráfico, por ejemplo GigabitEthernet0/0.',
      type: 'text',
      placeholder: 'GigabitEthernet0/0',
      required: true,
    },
    {
      key: 'vlan',
      label: 'VLAN de bloqueo',
      help: 'La VLAN en la que se aplican los bloqueos de aparatos. Si no usas VLAN, déjalo en 1.',
      type: 'text',
      placeholder: '1',
      required: false,
      defaultValue: '1',
    },
  ],
  troubleshooting: [
    {
      q: 'No conecta por SSH.',
      a: 'Verifica que SSH está habilitado (ip ssh version 2), que el usuario y contraseña son correctos y que el servidor de KrakenOS puede alcanzar el switch por el puerto indicado.',
    },
    {
      q: 'No puedo bloquear aparatos.',
      a: 'El bloqueo necesita que el usuario pueda entrar en modo configuración. Si tu equipo pide contraseña de "enable", asegúrate de haberla puesto.',
    },
    {
      q: '¿Y si tengo IOS-XE moderno?',
      a: 'Si tu equipo es IOS-XE 16.6 o superior, considera la opción "Cisco NETCONF", que es más limpia y robusta. Para IOS clásico o equipos antiguos, esta es la correcta.',
    },
  ],
};

const ciscoNetconf: IntegrationGuide = {
  id: 'cisco-netconf',
  domain: 'driver',
  kind: 'cisco-netconf',
  category: 'router',
  displayName: 'Cisco NETCONF',
  vendor: 'Cisco (IOS-XE 16.6+)',
  icon: 'Network',
  tier: 4,
  wifiSupported: false,
  intro:
    'Esta es la forma moderna de gestionar equipos Cisco que tengan IOS-XE 16.6 o superior. En lugar de "leer la pantalla" del equipo, KrakenOS habla con él en un formato estructurado (NETCONF), lo que hace los cambios más fiables y ordenados. Podrás ver los aparatos y bloquearlos. Igual que en la otra opción Cisco, la WiFi no aplica.',
  prerequisites: [
    'Un equipo Cisco con IOS-XE 16.6 o superior.',
    'NETCONF habilitado en el equipo (escucha en el puerto 830).',
    'Un usuario con permisos para consultar y modificar la configuración.',
  ],
  steps: [
    {
      title: 'Habilita NETCONF en el equipo',
      body: 'Entra en modo configuración y activa NETCONF con el comando "netconf-yang", crea un usuario administrador y guarda. El bloque de abajo lo hace; cambia "TU_PASSWORD" por una contraseña segura.',
      command:
        'configure terminal\n netconf-yang\n username admin privilege 15 secret TU_PASSWORD\nend\nwrite memory',
      external: true,
    },
    {
      title: 'Conecta KrakenOS',
      body: 'Pon la dirección del equipo, el puerto de NETCONF (830 por defecto), el usuario y la contraseña, y la interfaz por la que medir el tráfico. Al guardar, el inventario se llena con lo que ve el equipo.',
    },
  ],
  fields: [
    {
      key: 'host',
      label: 'Dirección del equipo',
      help: 'La dirección IP del equipo Cisco en tu red.',
      type: 'host',
      placeholder: '192.168.1.254',
      required: true,
    },
    {
      key: 'port',
      label: 'Puerto NETCONF',
      help: 'La puerta por la que responde NETCONF. Por defecto es 830.',
      type: 'number',
      required: false,
      defaultValue: 830,
    },
    {
      key: 'username',
      label: 'Usuario',
      help: 'El usuario administrador que creaste.',
      type: 'text',
      placeholder: 'admin',
      required: true,
    },
    {
      key: 'password',
      label: 'Contraseña',
      help: 'La contraseña de ese usuario. Se guarda cifrada.',
      type: 'password',
      required: true,
      secret: true,
    },
    {
      key: 'interface',
      label: 'Interfaz de tráfico',
      help: 'El nombre de la interfaz por la que medir el tráfico, por ejemplo GigabitEthernet1.',
      type: 'text',
      placeholder: 'GigabitEthernet1',
      required: true,
    },
  ],
  troubleshooting: [
    {
      q: 'No responde en el puerto 830.',
      a: 'Confirma que ejecutaste "netconf-yang" y guardaste la configuración, y que el equipo es IOS-XE 16.6 o superior. Puedes verificarlo desde el servidor intentando una conexión NETCONF.',
    },
    {
      q: '¿Cuándo usar esta opción y no "Cisco IOS"?',
      a: 'Usa NETCONF solo si tu equipo es IOS-XE 16.6 o más nuevo: es más robusto. Para IOS clásico o equipos antiguos, usa la opción "Cisco IOS".',
    },
  ],
};

const mock: IntegrationGuide = {
  id: 'mock',
  domain: 'driver',
  kind: 'mock',
  category: 'router',
  displayName: 'Modo demostración',
  icon: 'FlaskConical',
  tier: 1,
  wifiSupported: true,
  intro:
    'El modo demostración simula una casa llena de aparatos, redes WiFi y tráfico, sin necesidad de ningún hardware real. Es perfecto para explorar KrakenOS con calma, aprender dónde está cada cosa y probar los botones (bloquear, cambiar WiFi, etc.) sin miedo a romper nada. Cuando quieras pasar a controlar tu red de verdad, elige el driver de tu router.',
  prerequisites: ['Nada. El modo demostración funciona tal cual, sin datos ni dispositivos.'],
  steps: [
    {
      title: 'Actívalo y explora',
      body: 'El modo demostración no pide ninguna configuración. Al activarlo, verás un inventario de ejemplo con aparatos, redes WiFi simuladas y gráficas de tráfico que se mueven solas. Todo es ficticio y seguro: puedes tocar cualquier cosa.',
    },
    {
      title: 'Cuando estés listo, conecta tu router de verdad',
      body: 'Cuando te sientas cómodo, vuelve al asistente y elige el modelo de tu router (OpenWrt, ASUS, UniFi, Omada, MikroTik...). A partir de ahí, KrakenOS mostrará y gestionará tu red real en lugar de la simulada.',
    },
  ],
  fields: [],
  troubleshooting: [
    {
      q: '¿Los aparatos que veo son reales?',
      a: 'No. En modo demostración todo es simulado para que puedas explorar. Para ver tus aparatos reales, conecta el driver de tu router.',
    },
    {
      q: '¿Puedo hacer daño probando cosas aquí?',
      a: 'Para nada. Nada de lo que hagas en modo demostración afecta a tu red real, porque no hay ninguna conectada.',
    },
  ],
};

export const DRIVER_GUIDES: IntegrationGuide[] = [
  openwrt,
  asus,
  unifi,
  omada,
  mikrotik,
  pfsense,
  ciscoIos,
  ciscoNetconf,
  mock,
];
