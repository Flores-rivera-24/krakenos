import { registrarFragmento } from '../../registro';

/**
 * Fragmento «conectar» del catálogo en español: viaja con las pantallas que lo usan,
 * no con el arranque. Quien pinte una clave de aquí importa este módulo
 * (`import '@/lib/i18n/catalog/fragments/conectar';`): registrarlo antes del primer
 * render es lo que mantiene `t()` síncrono. Lo exige
 * `test/lib/catalogo-fragmentos.test.ts`.
 */
export const esConectar = {
  // --- Navegación, foco y nombres accesibles ---
  'wizard.field.moreInfo': 'Más información sobre {field}',

  // --- Conectar (US-139) ---
  'connect.loadError': 'No se pudo cargar el catálogo de integraciones',
  'connect.scanEmpty': 'Barrido terminado: nada nuevo por ahora',
  'connect.scanError': 'No se pudo buscar dispositivos',
  'connect.dismissError': 'No se pudo descartar la sugerencia',
  'connect.title': '¿Qué quieres conectar?',
  'connect.intro':
    'Elige el tipo de aparato o función y te guiamos paso a paso, sin tecnicismos. No necesitas salir de aquí ni leer manuales.',
  'connect.explore.title': '¿Solo quieres explorar?',
  'connect.explore.before': 'Activa el ',
  'connect.explore.strong': 'Modo demostración',
  'connect.explore.after':
    ' en «Tu red y router» para probar KrakenOS con una casa simulada, sin ningún aparato real.',
  'connect.retry': 'Reintentar',
  'connect.detected.title': 'Detectados en tu red',
  'connect.detected.desc':
    'KrakenOS sondea tu WiFi (solo tu red local, nada sale fuera) y te propone qué conectar. Tú confirmas.',
  'connect.scanning': 'Buscando…',
  'connect.scan': 'Buscar dispositivos',
  'connect.detected.empty':
    'Nada detectado por ahora. Pulsa «Buscar dispositivos» o conecta algo abajo a mano.',
  'connect.connect': 'Conectar',
  'connect.adopt': 'Añadir',
  'connect.adoptLabel': 'Añadir {label} a tus integraciones',
  'connect.adoptOk': 'Ya está en tus integraciones',
  'connect.adoptError': 'No se pudo añadir el dispositivo',
  'connect.configure': 'Configurar',
  'connect.dismissLabel': 'Descartar {label}',
  'connect.dismiss': 'Descartar',
  'connect.wizardTitle': 'Conectar {name}',
  'connect.wizardSubtitle': 'Te guiamos paso a paso',
  'connect.connected': 'Conectado',
  'connect.tier.1': 'Muy fácil',
  'connect.tier.2': 'Fácil',
  'connect.tier.3': 'Intermedio',
  'connect.tier.4': 'Avanzado',
  'guideStep.onDevice': 'En tu dispositivo',
  // Navegación del `Stepper`. Vive en la primitiva y no en cada asistente: eran
  // valores por defecto en español escritos en la firma del componente.
  'stepper.back': 'Atrás',
  'stepper.next': 'Siguiente',
  'stepper.finish': 'Finalizar',
  'stepper.skip': 'Omitir',
  'stepper.stepOf': 'Paso {n} de {total}',
  'stepper.stepOfWith': 'Paso {n} de {total}: {title}',
  // Chrome del asistente de conexión (US-262). El CUERPO de cada guía no vive
  // aquí: las guías se traducen por superposición según `guide.id` (US-177), que
  // es otro mecanismo a propósito. Esto son los pasos, los botones y los avisos.
  'wizard.step.prepare': 'Prepara',
  'wizard.step.connect': 'Conecta',
  'wizard.step.save': 'Prueba y guarda',
  'wizard.finish': 'Guardar y conectar',
  'wizard.manufacturerApp.title': 'Vas a necesitar la app del fabricante',
  'wizard.manufacturerApp.pairing':
    'Hay que emparejar el aparato con la app del fabricante al menos una vez: la clave que permite controlarlo desde tu red la emite ese emparejamiento contra su nube.',
  'wizard.manufacturerApp.account': 'Para controlar {name} hace falta la cuenta del fabricante.',
  'wizard.manufacturerApp.localControl':
    'Hay que abrir la app del fabricante y activar el control local en cada aparato; hasta que lo hagas no responde dentro de tu red.',
  'wizard.manufacturerApp.some': 'Solo afecta a los {devices}.',
  'wizard.community.title': 'Soporte de la comunidad, sin garantía',
  'wizard.community.body':
    'KrakenOS no puede prometer que {name} siga funcionando si el fabricante cambia algo: el código se mantiene, pero sin garantía. Si buscas independencia de verdad, los aparatos Zigbee, Matter o Shelly se emparejan contra tu propio servidor.',
  'wizard.introFallback': 'Vamos a configurar {name}.',
  'wizard.prerequisites': 'Qué necesitas',
  'wizard.form.introBefore': 'Rellena los datos. Los marcados con ',
  'wizard.form.introAfter': ' son obligatorios; el resto puedes dejarlos como están.',
  'wizard.save.intro':
    'Prueba la conexión para confirmar que todo está bien y luego guarda. Si tu dispositivo no es accesible desde este navegador, puedes guardar sin probar.',
  'wizard.test': 'Probar conexión',
  'wizard.testing': 'Probando…',
  'wizard.saveWithoutTest': 'Guardar sin probar',
  'wizard.test.ok': 'Conexión correcta',
  'wizard.test.fail': 'No se pudo conectar',
  'wizard.troubleshooting': '¿Problemas?',
  'wizard.secretStored': '•••••• (guardado — deja en blanco para conservar)',
  'wizard.testError': 'No se pudo probar {name}',
  'wizard.saveError': 'No se pudo guardar {name}',
  'wizard.savedFallback':
    'La configuración de {name} se guardó pero no se pudo aplicar; sigue activa la configuración anterior',
  'wizard.connected': '¡{name} conectado!',
  // Compatibilidad de hardware (US-208)
  'compat.title': '¿Es compatible tu equipo?',
  'compat.subtitle': 'Busca tu router, cámara o dispositivo y mira qué se puede controlar.',
  'compat.search': 'Buscar por marca o modelo',
  'compat.all': 'Todo',
  'compat.none':
    'No encontramos ese equipo. Que no esté en la lista no significa que no funcione: muchos routers con OpenWrt o dispositivos estándar valen igual.',
  'compat.loadError': 'No se pudo cargar el catálogo de compatibilidad.',
  'compat.verified': 'Verificado con hardware',
  'compat.verifiedOn': 'Verificado con hardware el {date}',
  'compat.unverified': 'Soportado por código',
  'compat.community':
    'Community · sin garantía: puede dejar de funcionar si el fabricante cambia algo.',
  'compat.app.pairing':
    'Necesita la app del fabricante una vez: el emparejamiento se hace contra su nube.',
  'compat.app.account': 'Necesita la cuenta del fabricante para funcionar.',
  'compat.app.enable-local':
    'Necesita la app del fabricante para activar el control local en cada dispositivo.',
  'compat.app.only': 'Solo afecta a los {devices}.',
  'compat.needs': 'Necesita:',
  // Nombre de cada ficha: el agente manda el id (`<categoría>:<kind>`), no el texto.
  'compat.name.driver.openwrt': 'Router OpenWrt',
  'compat.name.driver.asus': 'Router ASUS',
  'compat.name.driver.unifi': 'UniFi Network',
  'compat.name.driver.omada': 'TP-Link Omada',
  'compat.name.driver.mikrotik': 'MikroTik RouterOS',
  'compat.name.driver.pfsense': 'pfSense',
  'compat.name.vpn.wireguard': 'WireGuard',
  'compat.name.iot.hue': 'Philips Hue',
  'compat.name.iot.govee': 'Govee',
  'compat.name.iot.mqtt': 'Descubrimiento MQTT (ESPHome, Tasmota…)',
  'compat.name.iot.zigbee': 'Zigbee2MQTT',
  'compat.name.iot.matter': 'Matter',
  'compat.name.iot.tuya': 'Tuya / Smart Life',
  'compat.name.iot.kasa': 'TP-Link Kasa / Tapo',
  'compat.name.iot.shelly': 'Shelly',
  'compat.name.iot.meross': 'Meross',
  'compat.name.cameras.rtsp': 'Cámaras RTSP',
  'compat.name.cameras.frigate': 'Frigate (NVR con detección de objetos)',
  'compat.name.firewall.iptables': 'iptables (Linux)',
  'compat.name.vlan.switch': 'Switch gestionado (SNMP)',
  'compat.name.qos.tc': 'Control de tráfico (Linux tc)',
  'compat.name.dns.pihole': 'Pi-hole',
  // Un valor que esta versión de la web no conoce se declara, no se pinta crudo.
  'compat.unknown': 'No reconocido ({value})',
  'compat.cat.driver': 'Routers y puntos de acceso',
  'compat.cat.iot': 'Dispositivos inteligentes',
  'compat.cat.cameras': 'Cámaras',
  'compat.cat.vpn': 'VPN',
  'compat.cat.firewall': 'Cortafuegos',
  'compat.cat.vlan': 'VLANs',
  'compat.cat.qos': 'QoS',
  'compat.cat.dns': 'DNS',
  'compat.cap.inventory': 'Inventario',
  'compat.cap.block': 'Bloquear',
  'compat.cap.traffic': 'Tráfico',
  'compat.cap.traffic-per-device': 'Tráfico por dispositivo',
  'compat.cap.wifi': 'WiFi',
  'compat.cap.control': 'Encender/atenuar',
  'compat.cap.vpn': 'VPN',
  'compat.cap.firewall': 'Cortafuegos',
  'compat.cap.vlan': 'VLANs',
  'compat.cap.qos': 'QoS',
  'compat.cap.dns-block': 'Bloqueo de dominios',
  'compat.cap.camera-stream': 'Vídeo en vivo',
  'compat.cap.camera-snapshot': 'Captura',
  'compat.req.address': 'dirección en tu red',
  'compat.req.credentials': 'usuario y contraseña',
  'compat.req.extra-dependency': 'un paquete extra en el servidor',
  // US-251: en el ROUTER, no en el servidor. Quien lo lee necesita saber dónde
  // teclea el comando.
  'compat.req.router-package': 'un paquete extra en el router',

  // --- Barrido de copy a pelo (constantes de módulo) ---
  'connect.category.router': 'Tu red y router',
  'connect.category.lights': 'Luces inteligentes',
  'connect.category.plugs': 'Enchufes e interruptores',
  'connect.category.cameras': 'Cámaras',
  'connect.category.remoteAccess': 'Acceso remoto (VPN)',
  'connect.category.adBlocking': 'Bloqueo de anuncios (DNS)',
  'connect.category.advanced': 'Red avanzada',
} as const;

registrarFragmento(esConectar);
