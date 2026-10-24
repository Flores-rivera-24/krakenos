import { registrarFragmento } from '../../registro';

/**
 * Fragmento «sondeo» del catálogo en español: viaja con las pantallas que lo usan,
 * no con el arranque. Quien pinte una clave de aquí importa este módulo
 * (`import '@/lib/i18n/catalog/fragments/sondeo';`): registrarlo antes del primer
 * render es lo que mantiene `t()` síncrono. Lo exige
 * `test/lib/catalogo-fragmentos.test.ts`.
 */
export const esSondeo = {
  // --- Conectar (US-139) ---
  'survey.title': 'Recorridos de medición',
  'survey.new': 'Nuevo',
  'survey.create': 'Crear recorrido',
  'survey.close': 'Cerrar recorrido',
  'survey.empty': 'Aún no hay recorridos. Crea uno para empezar a medir la cobertura real.',
  'survey.namePlaceholder': 'p. ej. Recorrido planta baja',
  'survey.band': 'Banda',
  'survey.device': 'Dispositivo itinerante',
  'survey.manualOption': 'Manual (introduzco los valores)',
  'survey.deviceHint':
    'Su señal en vivo se registrará al tocar el plano. Elige «Manual» si no aparece.',
  'survey.samples': '{n} {unidad}',
  'survey.sample.one': 'muestra',
  'survey.sample.other': 'muestras',
  'survey.rssiLabel': 'Señal a registrar (dBm)',
  'survey.manualHint':
    'Recorrido manual: escribe la señal que marca tu móvil (p. ej. −58) y toca el plano en ese punto para registrarla.',
  'survey.liveHint':
    'Modo medir activo: toca el plano donde estés para registrar la señal real de {mac} en ese punto.',
  'survey.adminOnly': 'Solo un administrador puede registrar mediciones.',
  'survey.computing': 'Calculando…',
  'survey.seePoints': 'Ver puntos',
  'survey.seeMeasured': 'Ver mapa medido',
  'survey.noSamples': 'Aún no hay muestras: mide algunos puntos para ver el mapa.',
  'survey.scanMac': ' · {mac}',
  'survey.scanManual': ' · manual',
  'survey.deleteAria': 'Eliminar {name}',
  'survey.loadError': 'No se pudieron cargar los recorridos',
  'survey.devicesError': 'No se pudo cargar la lista de dispositivos.',
  'survey.openError': 'No se pudo abrir el recorrido',
  'survey.createError': 'No se pudo crear el recorrido',
  'survey.deleteError': 'No se pudo eliminar el recorrido',
  'survey.heatmapError': 'No se pudo calcular el mapa medido',

  // --- Barrido de copy a pelo (componentes) ---
  'survey.created': 'Recorrido creado',
  'survey.deleted': 'Recorrido eliminado',
} as const;

registrarFragmento(esSondeo);
