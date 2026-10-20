import { registrarFragmento } from '../../registro';

/**
 * Fragmento «cobertura» del catálogo en español: viaja con las pantallas que lo usan,
 * no con el arranque. Quien pinte una clave de aquí importa este módulo
 * (`import '@/lib/i18n/catalog/fragments/cobertura';`): registrarlo antes del primer
 * render es lo que mantiene `t()` síncrono. Lo exige
 * `test/lib/catalogo-fragmentos.test.ts`.
 */
export const esCobertura = {
  // --- Conectar (US-139) ---
  'coverage.toolbar.label': 'Herramientas del plano',
  'coverage.tool.select': 'Seleccionar',
  'coverage.tool.wall': 'Pared',
  'coverage.tool.ap': 'Punto de acceso',
  'coverage.tool.measure': 'Medir',
  'coverage.plan.aria.one': 'Plano {name}: {w}×{h} m con {aps} punto de acceso',
  'coverage.plan.aria.other': 'Plano {name}: {w}×{h} m con {aps} puntos de acceso',
  'coverage.plan.namePlaceholder': 'p. ej. Planta baja',
  'coverage.plan.deleted': 'Plano eliminado',
  'coverage.plan.deleteError': 'No se pudo eliminar el plano',
  'coverage.plan.name': 'Nombre',
  'coverage.plan.width': 'Ancho (m)',
  'coverage.plan.height': 'Alto (m)',
  'coverage.plan.create': 'Crear plano',
  'coverage.plan.delete': 'Eliminar plano',
  'coverage.plan.deleting': 'Eliminando…',
  'coverage.plan.created': 'Plano creado',
  'coverage.plan.updated': 'Plano actualizado',
  'coverage.plan.createError': 'No se pudo crear el plano',
  'coverage.plan.newSubtitle': 'Define las medidas reales de la planta para calcular la cobertura',
  'coverage.plan.measuresHint':
    'Las medidas se usan para escalar el mapa de calor. Ajusta ancho y alto a los metros reales de tu casa para que la predicción sea fiable.',
  'coverage.ap.yours': 'Tus puntos de acceso',
  'coverage.ap.yoursHint': 'Detectados en tu red. Añádelos al plano y arrástralos a su sitio real.',
  'coverage.ap.none': 'No se detectaron puntos de acceso. Puedes añadir uno manual más abajo.',
  'coverage.ap.loadError': 'No se pudieron cargar los puntos de acceso',
  'coverage.ap.onPlan': 'En el plano',
  'coverage.ap.onPlanCount': 'En el plano ({n})',
  'coverage.ap.add': 'Añadir',
  'coverage.ap.addManual': 'Añadir AP manual',
  'coverage.ap.remove': 'Quitar {name}',
  'coverage.ap.power': 'Potencia (EIRP)',
  'coverage.ap.powerAria': 'Potencia de {name} en dBm',
  'coverage.ap.powerAssumed':
    'Valor asumido, no leído del punto de acceso. Si conoces su potencia real, ajústala: el mapa depende directamente de ella.',
  'coverage.ap.bands': 'Bandas',
  'coverage.ap.enabled': 'Activo',
  'coverage.ap.enableAria': 'Activar {name}',
  'coverage.legend.title': 'Intensidad de señal',
  'coverage.legend.aria': 'Degradado de señal de {min} a {max}',
  'coverage.quality.excellent': 'Excelente',
  'coverage.quality.good': 'Buena',
  'coverage.quality.fair': 'Aceptable',
  'coverage.quality.weak': 'Débil',
  'coverage.quality.none': 'Sin señal',
  'coverage.wall.drywall': 'Pladur/tabique',
  'coverage.wall.wood': 'Madera',
  'coverage.wall.glass': 'Cristal',
  'coverage.wall.brick': 'Ladrillo',
  'coverage.wall.concrete': 'Hormigón',
  'coverage.wall.metal': 'Metal',
  'coverage.wall.aria': '{material} — {x1},{y1} a {x2},{y2} m',

  // --- Cobertura WiFi (US-151) ---
  'coverage.title': 'Cobertura WiFi',
  'coverage.subtitle':
    'Dibuja el plano de tu casa, coloca los puntos de acceso y comprueba dónde llega la señal.',
  'coverage.newPlan': 'Nuevo plano',
  'coverage.empty.title': 'Aún no has creado ningún plano.',
  'coverage.empty.desc':
    'Crea un plano de tu casa con sus medidas para colocar los puntos de acceso y ver un mapa de calor de la cobertura WiFi.',
  'coverage.empty.create': 'Crear plano',
  'coverage.planLabel': 'Plano',
  'coverage.viewLabel': 'Vista',
  'coverage.bandLabel': 'Banda',
  'coverage.editPlan': 'Editar plano',
  'coverage.view.edit': 'Editar',
  'coverage.view.predict': 'Predicción',
  'coverage.view.survey': 'Medición',
  'coverage.edit.title': 'Editar el plano',
  'coverage.edit.hintWall': '«Pared»: arrastra para trazar un muro con el material elegido.',
  'coverage.edit.hintAp': '«Punto de acceso»: haz clic para colocar un AP.',
  'coverage.edit.hintSelect': '«Seleccionar»: arrastra un AP para moverlo.',
  'coverage.predict.title': 'Predicción de señal',
  'coverage.predict.desc':
    'Estimación por propagación RF con las paredes y los APs guardados en la banda {band}. Guarda tus cambios en «Editar» para verlos reflejados aquí.',
  'coverage.loadError': 'No se pudieron cargar los planos',
  'coverage.predictError': 'No se pudo calcular la predicción',
  'coverage.saved': 'Plano guardado',
  'coverage.saveError': 'No se pudo guardar el plano',
  'coverage.survey.pickFirst': 'Elige o crea un recorrido antes de medir',
  'coverage.survey.notFound': 'No se detectó el dispositivo aquí',
  'coverage.survey.measured': 'Medido: {value}',
  'coverage.survey.recordError': 'No se pudo registrar la medición',
  // Importar plano + calibración (US-194)
  'coverage.import.label': 'Plano de fondo (opcional)',
  'coverage.import.hint':
    'Sube una foto, un PDF o un Word con tu plano. Se procesa en tu navegador.',
  'coverage.import.choose': 'Elegir archivo',
  'coverage.import.processing': 'Procesando…',
  'coverage.import.remove': 'Quitar imagen',
  'coverage.import.preview': 'Vista previa del plano',
  'coverage.import.error.unsupported': 'Formato no admitido. Usa una imagen, un PDF o un Word.',
  'coverage.import.error.pdfUnreadable':
    'No pudimos leer este PDF. Sube una foto o captura del plano.',
  'coverage.import.error.docxNoImage': 'El documento no contiene ninguna imagen del plano.',
  'coverage.import.error.decode': 'No se pudo procesar la imagen.',
  'coverage.calibrate.button': 'Calibrar escala',
  'coverage.calibrate.title': 'Calibrar la escala',
  'coverage.calibrate.hint':
    'Traza una línea sobre algo de medida conocida (una pared, una puerta) y dinos cuánto mide.',
  'coverage.calibrate.meters': 'Medida real (m)',
  'coverage.calibrate.apply': 'Aplicar escala',
  'coverage.calibrate.cancel': 'Cancelar',
  'coverage.calibrate.needLine': 'Traza la línea de referencia sobre el plano.',
  'coverage.calibrate.done': 'Escala calibrada: {width} × {height} m',
  // Detección asistida de paredes (US-195)
  'coverage.survey.rssiTitle': 'La señal la mide el punto de acceso',
  'coverage.survey.rssiNote':
    'La señal la mide el punto de acceso, no tu móvil: es la fuerza con la que el router oye al dispositivo. Para lo que importa —dónde llega bien y dónde no— sirve igual, pero no es el mismo número que muestra el móvil.',
  'coverage.model.calibrated':
    'Modelo ajustado a tu casa con {n} mediciones (error medio {rmse} dB).',
  'coverage.model.generic':
    'Modelo genérico: usa constantes de libro, no medidas de tu casa. Haz un recorrido de medición para ajustarlo.',
  'coverage.model.predictedNote':
    'Esto es una predicción calculada sobre el plano, no una medición: no cambia si un punto de acceso se apaga.',
  'coverage.wall.selected': 'Pared seleccionada · material:',
  'coverage.wall.materialLabel': 'Material de la pared seleccionada',
  'coverage.wall.deselect': 'Quitar selección',
  'coverage.wall.hint': 'Toca una pared del plano para cambiar su material.',
  'coverage.detect.button': 'Detectar paredes',
  'coverage.detect.detecting': 'Detectando…',
  'coverage.detect.title': 'Paredes del plano',
  'coverage.detect.noImage': 'Sube un plano de fondo para detectar las paredes.',
  'coverage.detect.hint':
    'Revisa las paredes propuestas (punteadas), elige el material y acéptalas. Luego ajústalas o bórralas a mano.',
  'coverage.detect.found': '{count} paredes propuestas',
  'coverage.detect.none': 'No se detectaron paredes. Dibújalas a mano sobre el plano.',
  'coverage.detect.material': 'Material',
  'coverage.detect.accept': 'Aceptar todas',
  'coverage.detect.discard': 'Descartar',
  'coverage.detect.error': 'No se pudieron detectar las paredes',
  'coverage.detect.accepted': '{count} paredes añadidas',
  // Habitaciones detectadas del plano (US-196)
  'coverage.rooms.title': 'Habitaciones del plano',
  'coverage.rooms.hint':
    'Detecta los recintos cerrados por las paredes y créalos como habitaciones de un toque. Nada se crea automáticamente.',
  'coverage.rooms.area': 'Superficie del plano: {area} m²',
  'coverage.rooms.detect': 'Detectar habitaciones',
  'coverage.rooms.detecting': 'Detectando…',
  'coverage.rooms.needWalls': 'Dibuja o detecta las paredes primero.',
  'coverage.rooms.none':
    'No se detectaron recintos cerrados. Cierra las paredes o crea las habitaciones a mano.',
  'coverage.rooms.found': '{count} habitaciones detectadas',
  'coverage.rooms.roomArea': '{area} m²',
  'coverage.rooms.aps': '{count} AP dentro',
  'coverage.rooms.create': 'Crear',
  'coverage.rooms.creating': 'Creando…',
  'coverage.rooms.created': 'Habitación «{name}» creada',
  'coverage.rooms.error': 'No se pudo crear la habitación',
  'coverage.rooms.namePlaceholder': 'Nombre de la habitación',
  'coverage.rooms.defaultName': 'Habitación {n}',

  // --- Barrido de copy a pelo (componentes) ---
  'coverage.toolbar.material': 'Material',
  'coverage.toolbar.saved': 'Guardado',
} as const;

registrarFragmento(esCobertura);
