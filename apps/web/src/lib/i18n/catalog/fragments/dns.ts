import { registrarFragmento } from '../../registro';

/**
 * Fragmento «dns» del catálogo en español: viaja con las pantallas que lo usan,
 * no con el arranque. Quien pinte una clave de aquí importa este módulo
 * (`import '@/lib/i18n/catalog/fragments/dns';`): registrarlo antes del primer
 * render es lo que mantiene `t()` síncrono. Lo exige
 * `test/lib/catalogo-fragmentos.test.ts`.
 */
export const esDns = {
  // --- DNS (US-21) ---
  'dns.title': 'DNS',
  'dns.adblockTerm': 'Bloqueo de anuncios',
  'dns.subtitle.link': 'Bloqueo de dominios',
  'dns.subtitle.after': '(anuncios/rastreadores) y estadísticas de consultas.',
  'dns.stat.queries': 'Consultas',
  'dns.stat.blocked': 'Bloqueadas',
  'dns.stat.blockedPercent': '% Bloqueado',
  'dns.stat.domains': 'Dominios',
  'dns.blockCard.title': 'Bloquear dominio',
  'dns.domain': 'Dominio',
  'dns.domainHelp':
    'El nombre de una web, como ejemplo.com. Al bloquearlo, ningún aparato de tu casa podrá cargarlo (útil contra anuncios y rastreadores).',
  'dns.domainHelpLabel': '¿Qué es un dominio?',
  'dns.domainPlaceholder': 'p. ej. ads.ejemplo.com',
  'dns.blocking': 'Bloqueando…',
  'dns.block': 'Bloquear',
  'dns.blocklist.title': 'Lista de bloqueo',
  'dns.col.domain': 'Dominio',
  'dns.col.action': 'Acción',
  'dns.empty.title': 'Aún no hay dominios bloqueados.',
  'dns.empty.desc': 'El bloqueo por DNS filtra anuncios y rastreadores para toda la casa.',
  'dns.empty.cta': 'Añade un dominio arriba para empezar.',
  'dns.remove': 'Quitar',
  'dns.removeLabel': 'Quitar {domain}',
  'dns.queries.title': 'Consultas recientes',
  'dns.col.client': 'Cliente',
  'dns.col.status': 'Estado',
  'dns.col.time': 'Hora',
  'dns.col.device': 'Dispositivo',
  'dns.queries.empty': 'Aún no hay consultas recientes.',
  'dns.history.title': 'Histórico por dispositivo',
  'dns.history.subtitle.admin': 'A qué dominios ha hablado cada dispositivo del hogar.',
  'dns.history.subtitle.own': 'A qué dominios han hablado tus dispositivos.',
  'dns.history.unknownDevice': 'Sin identificar',
  'dns.history.empty.notYet': 'Aún no se ha registrado ninguna consulta.',
  'dns.history.empty.none': 'Tus dispositivos no han hecho consultas en este periodo.',
  'dns.history.retention': 'Se conservan {days} días y luego se eliminan solas.',
  'dns.history.silentTitle': 'Hay dispositivos que no pasan por aquí',
  'dns.history.silentDesc':
    '{silent} de tus {online} dispositivos en línea no han hecho ni una consulta. O llevan un rato sin actividad, o resuelven por su cuenta (DoH o un DNS fijo) y de esos no se ve nada desde aquí.',
  'dns.history.clear': 'Eliminar el histórico',
  'dns.history.cleared': 'Histórico eliminado',
  'dns.history.clearError': 'No se pudo eliminar el histórico',
  // US-250: «no hay consultas» sería mentira cuando lo que falta es el permiso.
  'dns.queries.adminOnly': 'Solo el administrador ve las consultas recientes',
  'dns.queries.adminOnlyDesc':
    'El registro dice a qué dominios se conecta cada dispositivo de la casa, así que se reserva a quien administra la instalación. Las cifras de arriba y la lista de bloqueo las puede ver cualquiera.',
  'dns.blocked': 'Bloqueada',
  'dns.allowed': 'Permitida',
  'dns.loadError': 'No se pudo cargar el DNS',
  'dns.domainBlocked': 'Dominio bloqueado',
  'dns.blockError': 'No se pudo bloquear el dominio',
  'dns.domainRemoved': 'Dominio eliminado',
  'dns.removeError': 'No se pudo eliminar el dominio',

  // --- Conectar (US-139) ---
  'dns.feeds.title': 'Listas por categoría',
  'dns.feeds.hint':
    'Suscríbete a listas curadas de bloqueo (publicidad, malware, rastreo). Requiere Pi-hole; el resolver las gestiona por URL.',
  'dns.feeds.enableAria': 'Activar {name}',
  'dns.feeds.loadError': 'No se pudieron cargar las listas',
  'dns.feeds.toggleError': 'No se pudo cambiar la lista',
  // El agente manda el id del feed y el copy vive aquí (traducible).
  'dns.feeds.unknown': 'Lista no reconocida ({id})',
  'dns.feed.ads.name': 'Publicidad y rastreo',
  'dns.feed.ads.description': 'Bloquea anuncios, banners y rastreadores comunes (StevenBlack).',
  'dns.feed.malware.name': 'Malware y phishing',
  'dns.feed.malware.description': 'Dominios maliciosos y de phishing conocidos (URLhaus).',
  'dns.feed.tracking-extended.name': 'Rastreo extendido',
  'dns.feed.tracking-extended.description':
    'Telemetría y rastreo adicional (lista de Perflyst/SmartTV opcional).',
} as const;

registrarFragmento(esDns);
