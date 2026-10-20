import { registrarFragmento } from '../../registro';

/**
 * Fragmento «qos» del catálogo en español: viaja con las pantallas que lo usan,
 * no con el arranque. Quien pinte una clave de aquí importa este módulo
 * (`import '@/lib/i18n/catalog/fragments/qos';`): registrarlo antes del primer
 * render es lo que mantiene `t()` síncrono. Lo exige
 * `test/lib/catalogo-fragmentos.test.ts`.
 */
export const esQos = {
  // --- QoS (US-20) ---
  'qos.title': 'QoS',
  'qos.subtitle': 'Prioriza y limita el ancho de banda por dispositivo o servicio.',
  'qos.priority.high': 'Alta',
  'qos.priority.normal': 'Normal',
  'qos.priority.low': 'Baja',
  'qos.newRule': 'Nueva regla',
  'qos.name': 'Nombre',
  'qos.namePlaceholder': 'p. ej. Prioridad trabajo',
  'qos.target': 'Objetivo',
  'qos.targetHelp':
    'El aparato o servicio al que se aplica la regla: su IP (192.168.1.50), su dirección MAC o el nombre de un servicio.',
  'qos.targetHelpLabel': '¿Qué es el objetivo?',
  'qos.targetPlaceholder': 'IP/MAC/servicio',
  'qos.priority': 'Prioridad',
  'qos.priorityHelp':
    'Cuando la red se satura, el tráfico de prioridad alta pasa primero y el de prioridad baja espera. La mayoría del tráfico va en «Normal».',
  'qos.priorityHelpLabel': '¿Qué es la prioridad?',
  'qos.download': 'Descarga en kbps (0 = sin límite)',
  'qos.kbpsHelp':
    'Límite de velocidad en kbps (1000 kbps ≈ 1 Mbps). Escribe 0 para no poner límite.',
  'qos.kbpsHelpLabel': '¿Qué son los kbps?',
  'qos.upload': 'Subida en kbps (0 = sin límite)',
  'qos.creating': 'Creando…',
  'qos.addRule': 'Añadir regla',
  'qos.rules': 'Reglas',
  'qos.col.active': 'Activa',
  'qos.col.name': 'Nombre',
  'qos.col.target': 'Objetivo',
  'qos.col.priority': 'Prioridad',
  'qos.col.action': 'Acción',
  'qos.empty.title': 'Aún no hay reglas de QoS.',
  'qos.empty.desc': 'La QoS reparte tu conexión para que lo importante no se resienta.',
  'qos.empty.cta':
    'Crea una regla arriba para, por ejemplo, dar prioridad a las videollamadas o limitar una descarga.',
  'qos.delete': 'Eliminar',
  'qos.deleteLabel': 'Eliminar regla {name}',
  'qos.toggleError': 'No se pudo actualizar {name}',
  'qos.toggleLabel': 'Activar regla {name}',
  'qos.loadError': 'No se pudieron cargar las reglas',
  'qos.ruleCreated': 'Regla creada',
  'qos.createError': 'No se pudo crear la regla',
  'qos.ruleRemoved': 'Regla eliminada',
  'qos.removeError': 'No se pudo eliminar',
} as const;

registrarFragmento(esQos);
