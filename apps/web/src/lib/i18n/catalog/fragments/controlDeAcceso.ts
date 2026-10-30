import { registrarFragmento } from '../../registro';

/**
 * Fragmento «controlDeAcceso» del catálogo en español: viaja con las pantallas que lo usan,
 * no con el arranque. Quien pinte una clave de aquí importa este módulo
 * (`import '@/lib/i18n/catalog/fragments/controlDeAcceso';`): registrarlo antes del primer
 * render es lo que mantiene `t()` síncrono. Lo exige
 * `test/lib/catalogo-fragmentos.test.ts`.
 */
export const esControlDeAcceso = {
  // --- Conectar (US-139) ---
  'pauseInternet.paused': 'Internet pausado',
  'pauseInternet.pauseError': 'No se pudo pausar',
  'pauseInternet.resumed': 'Internet reanudado',
  'pauseInternet.resumeError': 'No se pudo reanudar',
  'pauseInternet.until': 'Internet pausado hasta {time}',
  'pauseInternet.resume': 'Reanudar',
  'pauseInternet.label': 'Pausar internet:',
  'access.title': 'Control parental · horarios',
  'access.add': 'Añadir horario',
  'access.intro':
    'Corta el acceso a internet de este dispositivo en las ventanas que definas (p. ej. 21:00–07:00 de lunes a viernes).',
  'access.empty': 'Sin horarios: este dispositivo no tiene cortes programados.',
  'access.byPerson': 'lo pone la persona dueña',
  'access.namePlaceholder': 'Nombre (p. ej. Hora de dormir)',
  'access.defaultName': 'Sin internet',
  'access.from': 'De',
  'access.to': 'a',
  'access.pickDay': 'Elige al menos un día.',
  'access.days': 'Días',
  'access.created': 'Horario creado',
  'access.loadError': 'No se pudieron cargar los horarios',
  'access.createError': 'No se pudo crear el horario',
  'access.toggleError': 'No se pudo cambiar el horario',
  'access.deleteError': 'No se pudo eliminar el horario',
  'access.toggleLabel': 'Activar {name}',
  'access.deleteLabel': 'Eliminar {name}',
} as const;

registrarFragmento(esControlDeAcceso);
