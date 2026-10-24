import { registrarFragmento } from '../../registro';

/**
 * Fragmento «trafico» del catálogo en español: viaja con las pantallas que lo usan,
 * no con el arranque. Quien pinte una clave de aquí importa este módulo
 * (`import '@/lib/i18n/catalog/fragments/trafico';`): registrarlo antes del primer
 * render es lo que mantiene `t()` síncrono. Lo exige
 * `test/lib/catalogo-fragmentos.test.ts`.
 */
export const esTrafico = {
  // --- Tráfico (US-46) ---
  'traffic.loadError': 'No se pudo cargar el tráfico',
  'traffic.title': 'Monitor de tráfico',
  'traffic.subtitle': 'Uso de la WAN en tiempo real.',
  'traffic.download': 'Descarga',
  'traffic.upload': 'Subida',
  'traffic.bandwidth': 'Ancho de banda (Mbps)',
  'traffic.waiting': 'Esperando muestras…',
  'traffic.history': 'Histórico',
  'traffic.rangeLabel': 'Rango',
  'traffic.totalDownloaded': 'Descargado',
  'traffic.totalUploaded': 'Subido',
  'traffic.noHistory': 'Sin datos históricos.',
  'traffic.byDevice': 'Por dispositivo',
  'traffic.deviceRangeLabel': 'Rango por dispositivo',
  'traffic.deviceCaption': 'Tráfico de red por dispositivo',
  'traffic.col.device': 'Dispositivo',
  'traffic.col.ip': 'IP',
  'traffic.sortLabel': 'Ordenar por descarga total',
  'traffic.col.download': '↓ Descarga',
  'traffic.col.upload': '↑ Subida',

  // --- Bienestar digital (US-184) ---
  'wellbeing.title': 'Uso por persona',
  'wellbeing.subtitle':
    'Uso de internet agregado por persona del hogar. Solo tú y los administradores veis el detalle de cada uno.',
  'wellbeing.rangeLabel': 'Rango',
  'wellbeing.loading': 'Cargando…',
  'wellbeing.loadError': 'No se pudo cargar el uso de internet.',
  'wellbeing.empty': 'Todavía no hay datos de uso en este periodo.',
  'wellbeing.noOwnedDevices':
    'Aún no tienes dispositivos asignados. Pídele a un administrador del hogar que te asigne los tuyos.',
  'wellbeing.noOwners':
    'Sin datos de uso todavía. Asigna un dueño a los dispositivos en su detalle.',
  'wellbeing.unsupported': 'Tu router no reparte el tráfico por dispositivo',
  'wellbeing.unsupportedDesc':
    'Esta función necesita que el router informe de cuántos datos consume cada dispositivo, y el tuyo solo informa del total de la casa. No es cosa de tu configuración: asignar dueños no lo arregla. Estamos trabajando en obtener ese dato de los routers que lo permiten.',
  'traffic.perDeviceUnsupported': 'Tu router no reparte el tráfico por dispositivo',
  'traffic.perDeviceUnsupportedDesc':
    'Solo informa del total de la casa, así que no se puede mostrar cuánto consume cada dispositivo ni el uso por persona. No es cosa de tu configuración.',
  // US-250: cuarto estado del vacío, y el único que no es del router. No lleva
  // instrucción a propósito: no es un ajuste pendiente, es un permiso, y pedirle al
  // usuario que lo arregle sería mandarlo a pelearse con algo que no depende de él.
  'traffic.perDeviceAdminOnly': 'Solo el administrador ve el consumo por dispositivo',
  'traffic.perDeviceAdminOnlyDesc':
    'Cuánto consume cada dispositivo permite deducir qué hace cada persona de la casa, así que el detalle se reserva a quien administra la instalación. Tu propio uso sí lo tienes más abajo, en «Uso por persona».',
  'wellbeing.unassigned': 'Sin asignar',
  // Un dueño que ya no existe: el agente manda `name: null`, no un texto.
  'wellbeing.unknown': 'Desconocido',
  // US-251: el estado que SÍ se arregla, y por eso lleva instrucción concreta.
  'perDeviceTraffic.setup.title': 'Tu router puede dar este dato, pero le falta un paquete',
  'perDeviceTraffic.setup.nlbwmon':
    'Instala «nlbwmon» en el router: en LuCI, Sistema → Software → Actualizar listas y buscar «nlbwmon»; o por SSH, «opkg update && opkg install nlbwmon luci-app-nlbwmon». KrakenOS lo detecta solo en unos minutos y empieza a contar desde ese momento.',
  'wellbeing.devices.one': '{n} dispositivo',
  'wellbeing.devices.other': '{n} dispositivos',

  // --- Conectar (US-139) ---
  // US-271: copy que vivía escrito en el componente. El valor español va VERBATIM
  // del código anterior, que es lo que hace que los ~490 tests que asertan texto
  // en español sigan pasando: si un valor se «mejora» al moverlo, el test que lo
  // cazaría es justo el que ya no compara con el original.
  'staleBadge.title': 'Sin datos en vivo: se muestran los últimos valores conocidos.',
  'staleBadge.label': 'Datos obsoletos',

  // --- Barrido de copy a pelo (componentes) ---
  'traffic.rowAria': 'Ver {name}',
} as const;

registrarFragmento(esTrafico);
