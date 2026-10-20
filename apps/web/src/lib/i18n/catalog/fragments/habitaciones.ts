import { registrarFragmento } from '../../registro';

/**
 * Fragmento «habitaciones» del catálogo en español: viaja con las pantallas que lo usan,
 * no con el arranque. Quien pinte una clave de aquí importa este módulo
 * (`import '@/lib/i18n/catalog/fragments/habitaciones';`): registrarlo antes del primer
 * render es lo que mantiene `t()` síncrono. Lo exige
 * `test/lib/catalogo-fragmentos.test.ts`.
 */
export const esHabitaciones = {
  // --- Habitaciones (US-165) ---
  'rooms.title': 'Habitaciones',
  'rooms.subtitle': 'Organiza tus dispositivos por habitación y contrólalos en grupo.',
  'rooms.loadError': 'No se pudieron cargar las habitaciones',
  'rooms.actionPartial': '{applied} aplicado(s), {failed} sin responder',
  'rooms.turnedOn': 'Habitación encendida',
  'rooms.turnedOff': 'Habitación apagada',
  'rooms.actionError': 'No se pudo aplicar la acción',
  'rooms.device.one': 'dispositivo',
  'rooms.device.other': 'dispositivos',
  'rooms.noSignal': ' · sin señal',
  'rooms.onCount.one': '{on}/{total} encendido',
  'rooms.onCount.other': '{on}/{total} encendidos',
  'rooms.noControllable': 'Sin luces ni enchufes',
  'rooms.turnOn': 'Encender',
  'rooms.turnOff': 'Apagar',
  'rooms.nameRequired': 'Ponle un nombre a la habitación.',
  'rooms.updated': 'Habitación actualizada',
  'rooms.created': 'Habitación creada',
  'rooms.saveError': 'No se pudo guardar la habitación',
  'rooms.deleted': 'Habitación eliminada',
  'rooms.deleteError': 'No se pudo eliminar la habitación',
  'rooms.editTitle': 'Editar habitación',
  'rooms.newTitle': 'Nueva habitación',
  'rooms.saving': 'Guardando…',
  'rooms.save': 'Guardar',
  'rooms.deleteRoom': 'Eliminar habitación',
  'rooms.name': 'Nombre',
  'rooms.namePlaceholder': 'Salón, Cocina, Dormitorio…',
  'rooms.icon': 'Icono',
  'rooms.icon.living': 'Salón',
  'rooms.icon.bedroom': 'Dormitorio',
  'rooms.icon.kitchen': 'Cocina',
  'rooms.icon.bathroom': 'Baño',
  'rooms.icon.dining': 'Comedor',
  'rooms.icon.office': 'Oficina',
  'rooms.icon.kids': 'Habitación infantil',
  'rooms.icon.garage': 'Garaje',
  'rooms.icon.garden': 'Jardín',
  'rooms.icon.generic': 'Otra',
  'rooms.empty.title': 'Aún no has creado ninguna habitación.',
  'rooms.empty.desc':
    'Agrupa tus luces, enchufes y dispositivos por habitación («Salón», «Cocina») para manejar tu casa como la piensas y encender o apagar todo de un toque.',
  'rooms.empty.cta': 'Crear la primera habitación',
  'rooms.empty.viewIot': 'Ver dispositivos IoT',
} as const;

registrarFragmento(esHabitaciones);
