import { registrarFragmento } from '../../registro';

/**
 * Fragmento «energia» del catálogo en español: viaja con las pantallas que lo usan,
 * no con el arranque. Quien pinte una clave de aquí importa este módulo
 * (`import '@/lib/i18n/catalog/fragments/energia';`): registrarlo antes del primer
 * render es lo que mantiene `t()` síncrono. Lo exige
 * `test/lib/catalogo-fragmentos.test.ts`.
 */
export const esEnergia = {
  // --- Energía (US-182) ---
  'energy.loadError': 'No se pudo cargar el consumo',
  'energy.title': 'Energía',
  'energy.subtitle': 'Consumo eléctrico de tus dispositivos y coste estimado.',
  'energy.totalConsumption': 'Consumo total',
  'energy.estimatedCost': 'Coste estimado',
  'energy.vsPrevious': 'Frente al periodo anterior',
  'energy.consumptionChart': 'Consumo ({unit})',
  'energy.consumption': 'Consumo',
  'energy.rangeLabel': 'Rango',
  'energy.exportCsv': 'Exportar CSV',
  'energy.noData': 'Aún no hay datos de consumo.',
  'energy.byDevice': 'Por dispositivo',
  'energy.noDevices': 'Ningún dispositivo reporta consumo todavía.',
  'energy.col.device': 'Dispositivo',
  'energy.col.room': 'Estancia',
  'energy.col.energy': 'Energía',
  'energy.col.cost': 'Coste',
  'energy.priceTitle': 'Precio de la electricidad',
  'energy.pricePerKwh': 'Precio por kWh',
  'energy.currency': 'Moneda',
  'energy.savePrice': 'Guardar',
  'energy.priceSaved': 'Precio actualizado',
  'energy.priceError': 'No se pudo guardar el precio',
  'energy.priceLoadError': 'No se pudo cargar el precio.',
  'energy.priceHint':
    'Déjalo en blanco para no estimar coste. El consumo se mide solo en aparatos que reportan potencia.',
  'energy.alert.title': 'Alertas de consumo',
  'energy.alert.rulesError': 'No se pudieron cargar las alertas de consumo.',
  'energy.alert.devicesError': 'No se pudo cargar la lista de aparatos.',
  'energy.alert.device': 'Dispositivo',
  'energy.alert.metric': 'Tipo',
  'energy.alert.sustainedPower': 'Potencia sostenida',
  'energy.alert.dailyEnergy': 'Energía diaria',
  'energy.alert.threshold': 'Umbral',
  'energy.alert.thresholdW': 'Umbral (W)',
  'energy.alert.thresholdWh': 'Umbral (Wh/día)',
  'energy.alert.minutes': 'Minutos',
  'energy.alert.add': 'Añadir',
  'energy.alert.delete': 'Eliminar alerta',
  'energy.alert.saved': 'Alerta creada',
  'energy.alert.error': 'No se pudo guardar la alerta',
  'energy.alert.invalid': 'Elige un dispositivo y un umbral válido',
  'energy.alert.describeSustained': 'más de {w} W durante {min} min',
  'energy.alert.describeDaily': 'más de {wh} Wh en un día',
  'energy.alert.hint':
    'El canal del aviso (push/email/Telegram) se elige en Ajustes → Alertas, evento «Consumo eléctrico anómalo».',
} as const;

registrarFragmento(esEnergia);
