import { registrarFragmento } from '../../registro';

/**
 * Fragmento «wifi» del catálogo en español: viaja con las pantallas que lo usan,
 * no con el arranque. Quien pinte una clave de aquí importa este módulo
 * (`import '@/lib/i18n/catalog/fragments/wifi';`): registrarlo antes del primer
 * render es lo que mantiene `t()` síncrono. Lo exige
 * `test/lib/catalogo-fragmentos.test.ts`.
 */
export const esWifi = {
  // --- Red WiFi (US-15) ---
  'wifi.title': 'Red WiFi',
  'wifi.subtitle.admin': 'Gestiona tu red principal y la de invitados.',
  'wifi.subtitle.readonly': 'Solo lectura — se requiere rol admin para editar.',
  'wifi.loadError': 'No se pudo cargar la configuración WiFi',
  'wifi.empty.title': 'Aún no hay configuración WiFi disponible.',
  'wifi.empty.desc':
    'La configuración WiFi aparece cuando tu router está conectado a KrakenOS. Conéctalo para gestionar desde aquí el nombre de tu red, la contraseña y la red de invitados.',
  'wifi.empty.cta': 'Conecta tu router',

  // --- Conectar (US-139) ---
  'wifi.networks.title': 'Puntos de acceso y redes',
  'wifi.networks.toggleLabel': 'Activar red {ssid}',
  'wifi.networks.toggleError': 'No se pudo cambiar la red {ssid}',
  'wifi.main.title': 'Red principal',
  'wifi.main.enableAria': 'Activar red principal',
  'wifi.guest.title': 'Red de invitados',
  'wifi.guest.enableAria': 'Activar red de invitados',
  'wifi.passPlaceholder': '•••••••• (dejar vacío para no cambiar)',
  'wifi.security': 'Seguridad',
  'wifi.security.open': 'Abierta (sin contraseña)',
  'wifi.security.helpLabel': '¿Qué es la seguridad WiFi?',
  'wifi.security.help':
    'El candado que protege tu WiFi con contraseña. WPA3 es lo más seguro; WPA2 es compatible con aparatos antiguos; el modo mixto WPA2/WPA3 acepta ambos.',
  'wifi.hidden': 'SSID oculto',
  'wifi.hidden.helpLabel': '¿Qué es un SSID oculto?',
  'wifi.hidden.help':
    'Si la activas, tu red no aparece en la lista de WiFi y hay que escribir el nombre a mano para conectarse. No la hace más segura, solo menos visible.',
  'wifi.isolation': 'Aislar clientes entre sí',
  'wifi.isolation.helpLabel': '¿Qué es aislar clientes?',
  'wifi.isolation.help':
    'Impide que los aparatos conectados a la red de invitados se vean entre sí. Ideal para que las visitas solo tengan internet y nada más.',
  'wifi.limit': 'Límite de ancho de banda (Mbps)',
  'wifi.limit.helpLabel': '¿Qué es el límite de ancho de banda?',
  'wifi.limit.help':
    'Velocidad máxima que puede usar la red de invitados, en Mbps (1000 Mbps = 1 Gbps). Déjalo vacío para no poner límite.',
  'wifi.noLimit': 'Sin límite',
  'wifi.saved': 'Cambios guardados',
  'wifi.saveError': 'No se pudo guardar',
  'wifi.saveChanges': 'Guardar cambios',
  'wifi.reason.ssid': 'el nombre de la red (SSID)',
  'wifi.reason.password': 'la contraseña',
  'wifi.reason.security': 'el tipo de seguridad',
  // La conjunción de la enumeración es traducible: en inglés es «and».
  'wifi.reason.join': '{list} y {last}',
  'wifi.disconnect.title': 'Esto desconectará todos tus dispositivos',
  'wifi.disconnect.body':
    'Al cambiar {motivos}, todo lo conectado a esta red se cae y hay que volver a conectarlo con los datos nuevos — incluido el teléfono o el portátil desde el que estás ahora. Si entras por WiFi, perderás el acceso hasta reconectar.',

  // --- Barrido de copy a pelo (componentes) ---
  'wifi.networks.band': 'Banda',
  'wifi.networks.clients': 'Clientes',
  'wifi.networks.active': 'Activa',
  'wifi.networks.guestTag': '(invitados)',
  'wifi.networks.clientsOf': 'Clientes · {ssid}',
  'wifi.networks.signal': 'Señal',
} as const;

registrarFragmento(esWifi);
