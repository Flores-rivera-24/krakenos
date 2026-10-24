import { registrarFragmento } from '../../registro';

/**
 * Fragmento «iot» del catálogo en español: viaja con las pantallas que lo usan,
 * no con el arranque. Quien pinte una clave de aquí importa este módulo
 * (`import '@/lib/i18n/catalog/fragments/iot';`): registrarlo antes del primer
 * render es lo que mantiene `t()` síncrono. Lo exige
 * `test/lib/catalogo-fragmentos.test.ts`.
 */
export const esIot = {
  // --- IoT (US-24) ---
  'iot.title': 'Dispositivos IoT',
  'iot.help':
    'IoT son los aparatos «inteligentes» de casa (luces, enchufes, sensores) que se conectan a la red. Desde aquí puedes encenderlos, apagarlos y ver sus lecturas.',
  'iot.helpLabel': '¿Qué es IoT?',
  'iot.subtitle.admin': 'Controla luces, enchufes, persianas y termostatos.',
  'iot.subtitle.viewer': 'Solo lectura — requiere rol admin.',
  'iot.patchError': 'No se pudo aplicar el cambio',
  'iot.toggleError': 'No se pudo cambiar {name}',
  'iot.turnOn': 'Encender {name}',
  'iot.turnOff': 'Apagar {name}',
  'iot.noRoom': 'Sin habitación',
  // US-244: nombres de métrica y estados de los sensores de suceso. Un «1» debajo
  // de «Puerta de entrada» no dice nada; «Abierta», sí.
  'iot.metric.temperature': 'Temperatura',
  'iot.metric.humidity': 'Humedad',
  'iot.metric.power': 'Potencia',
  'iot.metric.energy': 'Energía',
  'iot.metric.battery': 'Batería',
  'iot.metric.illuminance': 'Luz',
  'iot.metric.contact': 'Apertura',
  'iot.metric.occupancy': 'Presencia',
  'iot.metric.smoke': 'Humo',
  'iot.metric.co': 'Monóxido de carbono',
  'iot.state.open': 'Abierta',
  'iot.state.closed': 'Cerrada',
  'iot.state.occupied': 'Presencia detectada',
  'iot.state.clear': 'Sin presencia',
  'iot.state.smokeDetected': 'Humo detectado',
  'iot.state.noSmoke': 'Sin humo',
  'iot.state.coDetected': 'Monóxido detectado',
  'iot.state.noCo': 'Sin monóxido',
  'iot.cover.positionLabel': 'Posición',
  'iot.cover.positionOf': 'Posición de {name}',
  'iot.cover.open': 'Abrir',
  'iot.cover.close': 'Cerrar',
  'iot.cover.openOf': 'Abrir {name}',
  'iot.cover.closeOf': 'Cerrar {name}',
  'iot.climate.target': 'Objetivo {target} °C',
  'iot.climate.targetLabel': 'Temperatura objetivo',
  'iot.climate.noTarget': 'Este termostato no informa de su temperatura objetivo.',
  'iot.climate.warmer': 'Subir la temperatura objetivo de {name}',
  'iot.climate.cooler': 'Bajar la temperatura objetivo de {name}',
  'iot.brightness': 'Brillo',
  'iot.brightnessOf': 'Brillo de {name}',
  'iot.color': 'Color',
  'iot.roomUpdated': 'Habitación actualizada',
  'iot.roomsLoadError':
    'No se pudieron cargar las habitaciones; no se puede asignar ninguna por ahora.',
  'iot.roomAssignError': 'No se pudo asignar la habitación',
  'iot.loadError': 'No se pudieron cargar los dispositivos',
  'iot.empty.title': 'Aún no hay dispositivos IoT.',
  'iot.empty.desc':
    'Aquí controlarás tus luces, enchufes y sensores inteligentes. Conecta el primero y aparecerá en esta pantalla para encenderlo o apagarlo desde el móvil.',
  'iot.empty.cta': 'Conecta tu primera luz o enchufe',
} as const;

registrarFragmento(esIot);
