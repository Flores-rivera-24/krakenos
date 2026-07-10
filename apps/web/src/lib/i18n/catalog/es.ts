/**
 * Catálogo de traducciones en español (US-177) — **fuente de la verdad**.
 *
 * Las claves de `TranslationKey` derivan de este objeto y el catálogo `en` está
 * tipado como `Record<TranslationKey, string>`: añadir una clave aquí obliga a
 * traducirla en `en.ts` (paridad garantizada en tiempo de compilación).
 *
 * `es` es además el idioma por defecto: sus valores deben coincidir **carácter a
 * carácter** con el texto ya visible en la UI (los ~466 tests web los asertan).
 */
export const es = {
  // --- Navegación (US-163) ---
  'nav.connect': 'Conectar',
  'nav.dashboard': 'Dashboard',
  'nav.devices': 'Dispositivos',
  'nav.wifi': 'Red WiFi',
  'nav.coverage': 'Cobertura WiFi',
  'nav.traffic': 'Tráfico',
  'nav.rooms': 'Habitaciones',
  'nav.scenes': 'Escenas',
  'nav.automations': 'Automatizaciones',
  'nav.iot': 'IoT',
  'nav.cameras': 'Cámaras',
  'nav.vpn': 'VPN',
  'nav.firewall': 'Firewall',
  'nav.vlans': 'VLANs',
  'nav.qos': 'QoS',
  'nav.dns': 'DNS',
  'nav.settings': 'Ajustes',
  'nav.group.general': 'General',
  'nav.group.network': 'Red',
  'nav.group.home': 'Hogar',
  'nav.group.advanced': 'Red avanzada',
  'nav.group.system': 'Sistema',

  // --- Arranque / genéricos ---
  'app.booting': 'Iniciando KrakenOS…',
  'common.close': 'Cerrar',
  'common.logout': 'Salir',

  // --- Shell / layout ---
  'layout.expandMenu': 'Expandir menú',
  'layout.collapseMenu': 'Colapsar menú',
  'layout.moreSections': 'Más secciones',
  'layout.more': 'Más',
  'layout.homeConnected': 'Casa conectada',
  'layout.noRouterConnection': 'Sin conexión con el router',
  'layout.driver': 'Driver',
  'layout.uptime': 'Uptime',

  // --- Errores (US-93 / US-177) ---
  // `errors.network` lo genera el frontend (fetch rechazada). Los `errors.code.*`
  // traducen errores del agente por su `code`; en español el agente ya responde
  // en español, así que solo se usan cuando el idioma activo no es `es`.
  'errors.network': 'No se pudo conectar con el servidor. Revisa tu conexión.',
  'errors.code.AUTH_INVALID_CREDENTIALS': 'Credenciales incorrectas.',
  'errors.code.RATE_LIMITED': 'Demasiados intentos. Espera un momento e inténtalo de nuevo.',
  'errors.code.VALIDATION': 'Revisa los datos e inténtalo de nuevo.',

  // --- Setup / wizard (US-81/105) ---
  'setup.welcome': 'Bienvenido a KrakenOS',
  'setup.subtitle': 'Configura tu administrador para empezar.',
  'setup.defaultHomeName': 'Mi hogar',
  'setup.homeName': 'Nombre del hogar',
  'setup.displayName': 'Tu nombre',
  'setup.email': 'Email',
  'setup.password': 'Contraseña',
  'setup.confirm': 'Confirmar contraseña',
  'setup.token': 'Token de configuración',
  'setup.tokenHint': 'Lo imprimió el agente en su log al arrancar (busca «Token de configuración»).',
  'setup.submit': 'Crear administrador',
  'setup.submitting': 'Configurando…',
  'setup.error.mismatch': 'Las contraseñas no coinciden.',
  'setup.error.short': 'La contraseña debe tener al menos 8 caracteres.',
  'setup.error.generic': 'No se pudo completar la configuración',

  // --- Login (US-49/50/55/59) ---
  'login.verifying': 'Verificando…',
  'login.health.online': 'Sistema en línea',
  'login.health.offline': 'Sin conexión',
  'login.welcome': 'Bienvenido de vuelta',
  'login.email': 'Correo electrónico',
  'login.password': 'Contraseña',
  'login.showPassword': 'Mostrar contraseña',
  'login.hidePassword': 'Ocultar contraseña',
  'login.keepSignedIn': 'Mantener sesión iniciada',
  'login.submit': 'Iniciar sesión',
  'login.submitting': 'Entrando…',
  'login.error.credentials': 'Correo o contraseña incorrectos.',
  'login.error.connection': 'No se pudo conectar con el servidor. Inténtalo de nuevo.',
  'login.lastAccess': 'Último acceso',
  'login.tagline': 'Acceso local · Sin nube · Sin terceros',
  'login.mfa.title': 'Verifica tu identidad con tu dispositivo',
  'login.mfa.cancelled': 'Verificación cancelada. Inténtalo de nuevo.',
  'login.mfa.error': 'No se pudo verificar la passkey. Inténtalo de nuevo.',
  'login.mfa.usePasskey': 'Usar passkey',
  'login.mfa.retry': 'Reintentar',
  'login.backup.label': 'Código de recuperación',
  'login.backup.verify': 'Verificar código',
  'login.backup.invalid': 'Código inválido o ya usado.',
  'login.backup.prompt': '¿Perdiste tu dispositivo? Usar un código de recuperación',

  // --- Ajustes → Cuenta: modo de la interfaz (US-176) ---
  'settings.uiMode.title': 'Modo de la aplicación',
  'settings.uiMode.simple': 'Sencillo',
  'settings.uiMode.simpleDesc':
    'Solo lo cotidiano: dispositivos, hogar, WiFi y cámaras. Sin jerga técnica.',
  'settings.uiMode.advanced': 'Avanzado',
  'settings.uiMode.advancedDesc': 'Todo, incluida la red avanzada (VPN, firewall, VLANs, QoS, DNS).',
  'settings.uiMode.simpleOn': 'Modo sencillo activado',
  'settings.uiMode.advancedOn': 'Modo avanzado activado',
  'settings.uiMode.error': 'No se pudo cambiar el modo',

  // --- Ajustes → Cuenta: idioma (US-177) ---
  'settings.language.title': 'Idioma',
  'settings.language.es': 'Español',
  'settings.language.en': 'English',
  'settings.language.esDesc': 'La interfaz en español.',
  'settings.language.enDesc': 'The interface in English.',
  'settings.language.changed': 'Idioma cambiado',
  'settings.language.error': 'No se pudo cambiar el idioma',
} as const;

/** Clave válida del catálogo (derivada de la fuente en español). */
export type TranslationKey = keyof typeof es;
