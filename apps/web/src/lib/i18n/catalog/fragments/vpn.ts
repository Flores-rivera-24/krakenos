import { registrarFragmento } from '../../registro';

/**
 * Fragmento «vpn» del catálogo en español: viaja con las pantallas que lo usan,
 * no con el arranque. Quien pinte una clave de aquí importa este módulo
 * (`import '@/lib/i18n/catalog/fragments/vpn';`): registrarlo antes del primer
 * render es lo que mantiene `t()` síncrono. Lo exige
 * `test/lib/catalogo-fragmentos.test.ts`.
 */
export const esVpn = {
  // --- VPN / Acceso remoto (US-18) ---
  'vpn.title': 'VPN / Acceso remoto',
  'vpn.subtitle.before': 'Conecta tus dispositivos por ',
  'vpn.subtitle.after': '. Ningún puerto queda expuesto a internet.',
  'vpn.qrHelp':
    'Instala la app gratuita de WireGuard en tu móvil. Al crear el dispositivo aquí aparecerá un código QR: escanéalo desde la app y ya podrás conectarte a tu red de casa desde cualquier lugar. El QR solo se muestra una vez.',
  'vpn.qrHelp.label': '¿Cómo funciona el QR?',
  'vpn.loadError': 'No se pudo cargar la VPN',
  'vpn.peerAdded': 'Dispositivo añadido',
  'vpn.peerAddError': 'No se pudo añadir el dispositivo',
  'vpn.peerRemoved': 'Dispositivo eliminado',
  'vpn.peerRemoveError': 'No se pudo eliminar el dispositivo',
  'vpn.server': 'Servidor',
  'vpn.status': 'Estado',
  'vpn.status.active': 'Activo',
  'vpn.status.inactive': 'Inactivo',
  'vpn.endpoint': 'Endpoint',
  'vpn.devices': 'Dispositivos',
  'vpn.unavailable': 'No disponible.',
  'vpn.addDevice': 'Añadir dispositivo',
  'vpn.name': 'Nombre',
  'vpn.namePlaceholder': 'p. ej. Móvil de Emilio',
  'vpn.adding': 'Añadiendo…',
  'vpn.authorized': 'Dispositivos autorizados',
  'vpn.col.name': 'Nombre',
  'vpn.col.vpnIp': 'IP VPN',
  'vpn.col.publicKey': 'Clave pública',
  'vpn.col.action': 'Acción',
  'vpn.empty.title': 'Sin dispositivos. Crea el primero arriba.',
  // Sin formulario de alta (el equipo no puede ser servidor): no se manda a «crear arriba».
  'vpn.empty.titleReadOnly': 'Sin dispositivos.',
  'vpn.empty.desc':
    'Dale un nombre a tu móvil u ordenador y pulsa «Añadir dispositivo»: obtendrás un QR para conectarlo a tu red desde cualquier lugar con la app de WireGuard.',
  'vpn.delete': 'Eliminar',
  'vpn.deleteLabel': 'Eliminar {name}',

  // --- Tailscale + acceso móvil (US-215) ---
  'vpn.tailscale.title': 'Acceso remoto vía Tailscale',
  'vpn.tailscale.desc':
    'Para casas sin IP pública (CGNAT): túnel sin abrir puertos. KrakenOS lo detecta y te guía; no administra tu red Tailscale.',
  'vpn.tailscale.state': 'Estado',
  'vpn.tailscale.state.running': 'Activo',
  'vpn.tailscale.state.needs-login': 'Falta iniciar sesión',
  'vpn.tailscale.state.stopped': 'Instalado, sin responder',
  'vpn.tailscale.state.not-installed': 'No detectado',
  'vpn.tailscale.magicDns': 'Nombre MagicDNS',
  'vpn.tailscale.magicDnsHint':
    'Entra desde fuera usando este nombre como host (misma URL y puerto que en casa).',
  'vpn.tailscale.ip': 'IP del tailnet',
  'vpn.tailscale.version': 'Versión',
  'vpn.tailscale.needsLoginHint':
    'Tailscale está instalado pero sin sesión iniciada. Inícala desde el servidor:',
  'vpn.tailscale.stoppedHint':
    'Hay rastro de Tailscale pero el daemon no responde. Arráncalo desde el servidor:',
  'vpn.tailscale.notInstalledHint':
    'No se detecta tailscaled en el servidor. Si tu conexión no tiene IP pública, instálalo con un comando:',
  'vpn.tailscale.wireguardNote':
    'Con IP pública, la VPN WireGuard de arriba sigue siendo la vía recomendada.',
  'vpn.tailscale.webauthnNote':
    'Si usas passkeys, configura WEBAUTHN_RP_ID con este nombre como host.',
  'vpn.tailscale.loadError': 'No se pudo consultar Tailscale',
  'vpn.tailscale.copy': 'Copiar',
  'vpn.tailscale.copied': '¡Copiado!',
  'vpn.mobile.title': 'Tu móvil en 3 pasos',
  'vpn.mobile.desc': 'Con esto, abrir la app en el teléfono conecta directo — en casa y fuera.',
  'vpn.mobile.step1.title': 'Instala la app (PWA)',
  'vpn.mobile.step1.desc':
    'Abre KrakenOS en el navegador del teléfono y añádela a la pantalla de inicio (Android: menú de Chrome → «Añadir a pantalla de inicio»; iPhone: Compartir → «Añadir a pantalla de inicio»). En iPhone, las notificaciones push solo llegan con la app instalada.',
  'vpn.mobile.step2.title': 'Túnel automático',
  'vpn.mobile.step2.desc':
    'En la app de WireGuard, activa el modo automático (iPhone: «On-Demand» al salir de tu WiFi; Android: «VPN siempre activa»). Con Tailscale, deja su app conectada. Así el túnel se levanta solo al salir de casa.',
  'vpn.mobile.step3.title': 'Una sola dirección',
  'vpn.mobile.step3.desc':
    'La app instalada queda atada a su dirección: usa un nombre (no la IP) que funcione igual en casa y por el túnel — p. ej. un registro local en tu Pi-hole (repartido por la VPN) o el nombre MagicDNS de Tailscale.',
  'vpn.mobile.note':
    'Hecho esto: icono en el inicio, sesión que se mantiene sola y avisos push — sin abrir ningún puerto a internet.',

  // --- Conectar (US-139) ---
  'vpn.peer.delete': 'Eliminar dispositivo',
  'vpn.peer.publicKey': 'Clave pública',
  'vpn.peer.created': 'Creado',
  'vpn.peer.lastHandshake': 'Último handshake',
  'vpn.peer.never': 'nunca',
  'vpn.peer.qrHint': 'Escanea el QR en la app de WireGuard. Esta config solo se muestra una vez.',
  'vpn.peer.qrAlt': 'QR de configuración WireGuard',
  'vpn.peer.noConfig': 'La configuración y el QR solo están disponibles al crear el dispositivo.',

  // --- Barrido de copy a pelo (componentes) ---
  'vpn.peerRowAria': 'Ver el peer {name}',
} as const;

registrarFragmento(esVpn);
