import { registrarFragmento } from '../../registro';

/**
 * Fragmento «vlan» del catálogo en español: viaja con las pantallas que lo usan,
 * no con el arranque. Quien pinte una clave de aquí importa este módulo
 * (`import '@/lib/i18n/catalog/fragments/vlan';`): registrarlo antes del primer
 * render es lo que mantiene `t()` síncrono. Lo exige
 * `test/lib/catalogo-fragmentos.test.ts`.
 */
export const esVlan = {
  // --- VLANs (US-26) ---
  'vlan.title': 'VLANs',
  'vlan.subtitle': 'Segmenta la red en VLANs y asigna dispositivos a cada segmento.',
  'vlan.tagHelp':
    'Número (1–4094) que identifica la VLAN. Cada VLAN tiene el suyo, único: así el equipo de red sabe a qué segmento pertenece cada aparato.',
  'vlan.isolatedHelp':
    'Si la activas, los aparatos de esta VLAN no pueden comunicarse con los de otras. Útil para separar, por ejemplo, los aparatos inteligentes del resto de la casa.',
  'vlan.loadError': 'No se pudieron cargar las VLANs',
  'vlan.created': 'VLAN creada',
  'vlan.createError': 'No se pudo crear la VLAN',
  'vlan.removed': 'VLAN eliminada',
  'vlan.removeError': 'No se pudo eliminar la VLAN',
  'vlan.updated': 'VLAN actualizada',
  'vlan.assignError': 'No se pudo asignar la VLAN',
  'vlan.newVlan': 'Nueva VLAN',
  'vlan.tag': 'Tag (1-4094)',
  'vlan.tagHelpLabel': '¿Qué es el tag de una VLAN?',
  'vlan.name': 'Nombre',
  'vlan.namePlaceholder': 'p. ej. IoT',
  'vlan.subnet': 'Subred',
  'vlan.isolated': 'Aislada',
  'vlan.isolatedHelpLabel': '¿Qué es una VLAN aislada?',
  'vlan.creating': 'Creando…',
  'vlan.create': 'Crear VLAN',
  'vlan.noSubnet': 'sin subred',
  'vlan.deviceCount': '{count} dispositivos',
  'vlan.deleteLabel': 'Eliminar VLAN {name}',
  'vlan.delete': 'Eliminar',
  'vlan.empty.title': 'Aún no hay VLANs configuradas.',
  'vlan.empty.desc':
    'Una VLAN divide tu red en zonas separadas usando el mismo cableado, como poner tabiques a una habitación grande.',
  'vlan.empty.cta': 'Crea la primera arriba para, por ejemplo, aislar tus aparatos inteligentes.',
  'vlan.assignment': 'Asignación de dispositivos',
  'vlan.col.device': 'Dispositivo',
  'vlan.col.ip': 'IP',
  'vlan.col.vlan': 'VLAN',
  'vlan.noDevices': 'Aún no hay dispositivos en el inventario.',
  'vlan.deviceVlanLabel': 'VLAN de {name}',
  'vlan.noVlan': 'Sin VLAN',
} as const;

registrarFragmento(esVlan);
