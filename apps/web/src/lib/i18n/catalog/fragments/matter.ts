import { registrarFragmento } from '../../registro';

/**
 * Fragmento «matter» del catálogo en español: viaja con las pantallas que lo usan,
 * no con el arranque. Quien pinte una clave de aquí importa este módulo
 * (`import '@/lib/i18n/catalog/fragments/matter';`): registrarlo antes del primer
 * render es lo que mantiene `t()` síncrono. Lo exige
 * `test/lib/catalogo-fragmentos.test.ts`.
 */
export const esMatter = {
  // --- Puente Matter (US-171) ---
  'matter.title': 'Puente Matter (Alexa / Google / Apple)',
  'matter.subtitle':
    'Expón los dispositivos que elijas a tu asistente de voz como un hub Matter en tu red local, sin cuentas ni nube extra.',
  'matter.error': 'No se pudo actualizar el puente Matter',
  'matter.loadError': 'No se pudo cargar el puente Matter.',
  'matter.enable': 'Activar el puente',
  'matter.statusOff': 'Desactivado',
  'matter.statusWaiting': 'Esperando emparejamiento',
  'matter.statusCommissioned': 'Emparejado ({n})',
  'matter.qrAlt': 'Código QR de emparejamiento Matter',
  'matter.manualCode': 'Código manual',
  'matter.commissionHint':
    'Añade un «hub» o «dispositivo Matter» en tu app de Alexa/Google/Apple y escanea este QR (o teclea el código).',
  'matter.certWarning':
    'Al escanear el QR, Alexa/Google/Apple pueden avisar de que el dispositivo «no está certificado». Es normal: KrakenOS usa un identificador de prueba. Puedes continuar; algunos ecosistemas pueden limitar ciertas funciones.',
  'matter.devices': 'Dispositivos a exponer',
  'matter.noDevices': 'No hay dispositivos controlables que exponer todavía.',
  'matter.exposeAria': 'Exponer {name}',
  'matter.type.onoff': 'enchufe/luz',
  'matter.type.dimmable': 'luz regulable',
  'matter.type.color': 'luz de color',
  'matter.commission.title': 'Añadir un dispositivo Matter',
  'matter.commission.subtitle':
    'Pega el código QR o de emparejamiento (11 dígitos) de tu dispositivo Matter y KrakenOS lo añadirá directamente, sin la app del fabricante.',
  'matter.commission.placeholder': 'MT:… o 1234-567-8901',
  'matter.commission.add': 'Añadir',
  'matter.commission.ok': '«{name}» añadido correctamente',
  'matter.commission.err.invalidCode': 'El código no es válido. Revisa el QR o los 11 dígitos.',
  'matter.commission.err.notFound':
    'No se encontró el dispositivo. Acércalo al hub y asegúrate de que está en modo emparejamiento.',
  'matter.commission.err.threadNoBorder':
    'Es un dispositivo Thread y no hay un border router en tu red. Necesitas uno (p. ej. un HomePod, Echo o Nest compatible).',
  'matter.commission.err.unavailable':
    'No hay una integración Matter activa. Configúrala primero en Ajustes → Integraciones.',
  'matter.commission.err.failed': 'No se pudo añadir el dispositivo. Inténtalo de nuevo.',
} as const;

registrarFragmento(esMatter);
