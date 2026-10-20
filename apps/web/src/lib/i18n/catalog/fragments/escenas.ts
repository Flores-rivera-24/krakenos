import { registrarFragmento } from '../../registro';

/**
 * Fragmento «escenas» del catálogo en español: viaja con las pantallas que lo usan,
 * no con el arranque. Quien pinte una clave de aquí importa este módulo
 * (`import '@/lib/i18n/catalog/fragments/escenas';`): registrarlo antes del primer
 * render es lo que mantiene `t()` síncrono. Lo exige
 * `test/lib/catalogo-fragmentos.test.ts`.
 */
export const esEscenas = {
  // --- Escenas (US-166) ---
  'scenes.title': 'Escenas',
  'scenes.subtitle': 'Deja varios dispositivos como quieres con un solo toque.',
  'scenes.scheduleMoved':
    'Para que una escena se active sola a una hora o al atardecer, créala como rutina.',
  'scenes.scheduleMovedLink': 'Ir a Rutinas',
  'scenes.loadError': 'No se pudieron cargar las escenas',
  'scenes.devicesLoadError': 'No se pudieron cargar los dispositivos IoT',
  'scenes.actionPartial': '{applied} aplicado(s), {failed} sin responder',
  'scenes.activated': 'Escena «{name}» activada',
  'scenes.activateError': 'No se pudo activar la escena',
  'scenes.deviceCount.one': '{count} dispositivo',
  'scenes.deviceCount.other': '{count} dispositivos',
  'scenes.activating': 'Activando…',
  'scenes.activate': 'Activar',
  'scenes.captured': 'Estado actual capturado',
  'scenes.nameRequired': 'Ponle un nombre a la escena.',
  'scenes.updated': 'Escena actualizada',
  'scenes.created': 'Escena creada',
  'scenes.saveError': 'No se pudo guardar la escena',
  'scenes.deleted': 'Escena eliminada',
  'scenes.deleteError': 'No se pudo eliminar la escena',
  'scenes.editTitle': 'Editar escena',
  'scenes.newTitle': 'Nueva escena',
  'scenes.saving': 'Guardando…',
  'scenes.save': 'Guardar',
  'scenes.deleteScene': 'Eliminar escena',
  'scenes.name': 'Nombre',
  'scenes.namePlaceholder': 'Buenas noches, Cine…',
  'scenes.icon': 'Icono',
  'scenes.icon.morning': 'Buenos días',
  'scenes.icon.dinner': 'Cena',
  'scenes.icon.relax': 'Relax',
  'scenes.icon.party': 'Fiesta',
  'scenes.icon.focus': 'Concentración',
  'scenes.icon.scene': 'Escena',
  'scenes.devices': 'Dispositivos',
  'scenes.capture': 'Capturar estado actual',
  'scenes.noControllable': 'No hay luces ni enchufes que controlar todavía.',
  'scenes.includeLabel': 'Incluir {name}',
  'scenes.stateLabel': 'Estado de {name} en la escena',
  'scenes.brightness': 'Brillo',
  'scenes.brightnessLabel': 'Brillo de {name} en la escena',
  'scenes.empty.title': 'Aún no tienes escenas.',
  'scenes.empty.desc':
    'Una escena deja tus luces y enchufes como quieres de un toque. Empieza con una sugerencia o crea la tuya.',
  'scenes.empty.cta': 'Crear escena',

  // --- Conectar (US-139) ---
  'scenes.partial': '{applied} aplicado(s), {failed} sin responder',
  'scenes.ran': 'Escena «{name}» activada',
} as const;

registrarFragmento(esEscenas);
