import { registrarFragmento } from '../../registro';

/**
 * Fragmento «firewall» del catálogo en español: viaja con las pantallas que lo usan,
 * no con el arranque. Quien pinte una clave de aquí importa este módulo
 * (`import '@/lib/i18n/catalog/fragments/firewall';`): registrarlo antes del primer
 * render es lo que mantiene `t()` síncrono. Lo exige
 * `test/lib/catalogo-fragmentos.test.ts`.
 */
export const esFirewall = {
  // --- Firewall (US-19) ---
  'firewall.action.deny': 'Bloquear',
  'firewall.action.allow': 'Permitir',
  'firewall.protocol.any': 'Cualquiera',
  'firewall.help':
    'Un cortafuegos es el portero de tu red: cada regla decide si una conexión se permite o se bloquea, según de dónde viene, a dónde va y por qué puerto.',
  'firewall.actionHelp': '«Permitir» deja pasar la conexión; «Bloquear» la corta.',
  'firewall.sourceHelp':
    'De dónde viene la conexión. Puede ser una IP (192.168.1.50), un rango en formato CIDR (192.168.1.0/24 = toda esa red) o la dirección MAC de un aparato. Déjalo vacío para «cualquiera».',
  'firewall.destHelp':
    'A dónde va la conexión: una IP, un rango CIDR o un nombre de host. Déjalo vacío para «cualquiera».',
  'firewall.loadError': 'No se pudieron cargar las reglas',
  'firewall.ruleCreated': 'Regla creada',
  'firewall.createError': 'No se pudo crear la regla',
  'firewall.ruleRemoved': 'Regla eliminada',
  'firewall.removeError': 'No se pudo eliminar',
  'firewall.title': 'Firewall',
  'firewall.helpLabel': '¿Qué es un cortafuegos?',
  'firewall.subtitle':
    'Reglas que permiten o bloquean el tráfico por origen, destino, protocolo y puerto. Se evalúan por prioridad.',
  'firewall.newRule': 'Nueva regla',
  'firewall.name': 'Nombre',
  'firewall.namePlaceholder': 'p. ej. Bloquear cámara',
  'firewall.action': 'Acción',
  'firewall.actionHelpLabel': '¿Qué hace la acción?',
  'firewall.protocol': 'Protocolo',
  'firewall.source': 'Origen',
  'firewall.sourceHelpLabel': '¿Qué es el origen?',
  'firewall.sourcePlaceholder': 'IP/CIDR/MAC',
  'firewall.dest': 'Destino',
  'firewall.destHelpLabel': '¿Qué es el destino?',
  'firewall.destPlaceholder': 'IP/CIDR/host',
  'firewall.port': 'Puerto',
  'firewall.portPlaceholder': 'cualquiera',
  'firewall.creating': 'Creando…',
  'firewall.addRule': 'Añadir regla',
  'firewall.rules': 'Reglas',
  'firewall.col.active': 'Activa',
  'firewall.col.name': 'Nombre',
  'firewall.col.action': 'Acción',
  'firewall.col.protocol': 'Protocolo',
  'firewall.col.source': 'Origen',
  'firewall.col.dest': 'Destino',
  'firewall.col.port': 'Puerto',
  'firewall.empty.title': 'Aún no hay reglas configuradas.',
  'firewall.empty.desc':
    'El cortafuegos decide qué conexiones se permiten y cuáles se bloquean. Sin reglas, todo el tráfico pasa.',
  'firewall.empty.cta':
    'Crea una arriba para, por ejemplo, impedir que un aparato salga a internet.',
  'firewall.toggleError': 'No se pudo actualizar {name}',
  'firewall.toggleLabel': 'Activar regla {name}',
  'firewall.deleteLabel': 'Eliminar regla {name}',
  'firewall.ruleTitle': 'Regla: {name}',
  'firewall.rulePriority': 'Prioridad {priority}',
  'firewall.delete': 'Eliminar',
  'firewall.adminOnly': 'Solo el administrador ve las reglas del cortafuegos',
  'firewall.adminOnlyDesc':
    'Las reglas deciden qué tráfico entra y sale de la red de casa, así que verlas y cambiarlas se reserva a quien administra la instalación.',

  // --- Barrido de copy a pelo (componentes) ---
  'firewall.ruleRowAria': 'Editar la regla {name}',
} as const;

registrarFragmento(esFirewall);
