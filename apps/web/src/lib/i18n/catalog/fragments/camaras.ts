import { registrarFragmento } from '../../registro';

/**
 * Fragmento «camaras» del catálogo en español: viaja con las pantallas que lo usan,
 * no con el arranque. Quien pinte una clave de aquí importa este módulo
 * (`import '@/lib/i18n/catalog/fragments/camaras';`): registrarlo antes del primer
 * render es lo que mantiene `t()` síncrono. Lo exige
 * `test/lib/catalogo-fragmentos.test.ts`.
 */
export const esCamaras = {
  // --- Cámaras (US-25/148) ---
  'cameras.title': 'Cámaras',
  'cameras.subtitle': 'Vista de las cámaras IP del hogar.',
  'cameras.add': 'Añadir cámara',
  'cameras.tileAlt': 'Cámara {name}',
  'cameras.connecting': 'Conectando…',
  'cameras.noSignal': 'Sin señal',
  'cameras.snapshotError': 'No se pudo cargar la imagen.',
  'cameras.live': '● EN VIVO',
  'cameras.edit': 'Editar {name}',
  'cameras.delete': 'Eliminar {name}',
  'cameras.loadError': 'No se pudieron cargar las cámaras',
  'cameras.removed': 'Cámara eliminada',
  'cameras.removeError': 'No se pudo eliminar la cámara',
  'cameras.empty.admin': 'Aún no hay cámaras. Añade la primera con su URL RTSP.',
  'cameras.empty.viewer':
    'Aún no hay cámaras. Pídele a un administrador que añada la primera con su URL RTSP.',
  'cameras.watchLive': 'Ver en vivo',
  'cameras.stopLive': 'Detener',
  'cameras.starting': 'Iniciando vídeo…',
  'cameras.streamError': 'No se pudo iniciar el vídeo en vivo',
  'cameras.streamLimit': 'Demasiadas cámaras en vivo a la vez. Detén otra e inténtalo de nuevo.',
  'cameras.streamUnsupported': 'Tu navegador no puede reproducir este vídeo en vivo.',
  'cameras.motion.settings': 'Movimiento de {name}',
  'cameras.motion.title': 'Detección de movimiento',
  'cameras.motion.enabled': 'Detectar movimiento',
  'cameras.motion.enabledHint': 'Avisa (y puede disparar automatizaciones) al detectar movimiento.',
  'cameras.motion.record': 'Grabar un clip',
  'cameras.motion.recordHint': 'Guarda un vídeo corto de cada detección (revísalo en Grabaciones).',
  'cameras.recordings.open': 'Grabaciones de {name}',
  'cameras.recordings.title': 'Grabaciones',
  'cameras.recordings.empty': 'Aún no hay grabaciones de esta cámara.',
  'cameras.recordings.download': 'Descargar clip',
  'cameras.recordings.delete': 'Eliminar clip',
  'cameras.recordings.removed': 'Clip eliminado',
  'cameras.recordings.loadError': 'No se pudieron cargar las grabaciones',
  'cameras.recordings.downloadError': 'No se pudo descargar el clip',
  'cameras.recordings.removeError': 'No se pudo eliminar el clip',
  'cameras.motion.sensitivity': 'Sensibilidad',
  'cameras.motion.sensLow': 'Baja',
  'cameras.motion.sensMedium': 'Media',
  'cameras.motion.sensHigh': 'Alta',
  'cameras.motion.cooldown': 'Tiempo mínimo entre avisos (segundos)',
  'cameras.motion.arming': 'Cuándo vigilar',
  'cameras.motion.armAlways': 'Siempre',
  'cameras.motion.armNever': 'Nunca',
  'cameras.motion.armSchedule': 'Según horario',
  'cameras.motion.from': 'Desde',
  'cameras.motion.to': 'Hasta',
  'cameras.motion.loading': 'Cargando…',
  'cameras.motion.saving': 'Guardando…',
  'cameras.motion.save': 'Guardar',
  'cameras.motion.saved': 'Ajustes de movimiento guardados',
  'cameras.motion.loadError': 'No se pudo cargar la configuración de movimiento',
  'cameras.motion.saveError': 'No se pudo guardar la configuración de movimiento',

  // --- Conectar (US-139) ---
  'cameras.editTitle': 'Editar cámara',
  'cameras.addSubtitle': 'Conecta una cámara IP por su URL RTSP',
  'cameras.namePlaceholder': 'p. ej. Entrada',
  'cameras.room': 'Habitación',
  'cameras.model': 'Modelo',
  'cameras.updated': 'Cámara actualizada',
  'cameras.added': 'Cámara añadida',
  'cameras.addError': 'No se pudo añadir la cámara',
  'cameras.rtsp.helpLabel': '¿Qué es una URL RTSP y dónde encontrarla?',
  'cameras.rtsp.label': 'URL RTSP',
  'cameras.rtsp.help':
    'Es la dirección del vídeo en directo de tu cámara dentro de tu red. Suele estar en la app o el manual de la cámara (busca «RTSP», «ONVIF» o «stream»).',
  'cameras.rtsp.format': 'Formato típico:',
  'cameras.rtsp.keep': 'dejar en blanco para conservar',
  'cameras.rtsp.privacy':
    'La URL y las credenciales que escribas se guardan solo en tu servidor KrakenOS y nunca salen a internet.',

  // --- Barrido de copy a pelo (constantes de módulo) ---
  'cameras.rtsp.example': 'rtsp://usuario:contraseña@192.168.1.50:554/stream1',
} as const;

registrarFragmento(esCamaras);
