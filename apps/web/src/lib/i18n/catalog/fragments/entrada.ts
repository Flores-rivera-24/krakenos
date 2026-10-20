import { registrarFragmento } from '../../registro';

/**
 * Fragmento «entrada» del catálogo en español: viaja con las pantallas que lo usan,
 * no con el arranque. Quien pinte una clave de aquí importa este módulo
 * (`import '@/lib/i18n/catalog/fragments/entrada';`): registrarlo antes del primer
 * render es lo que mantiene `t()` síncrono. Lo exige
 * `test/lib/catalogo-fragmentos.test.ts`.
 */
export const esEntrada = {
  // --- Setup / wizard (US-81/105) ---
  'setup.checking': 'Comprobando la instalación…',
  'setup.statusUnknown':
    'No se pudo comprobar si esta instalación ya tiene administrador. Puedes continuar.',
  'setup.goToLogin': 'Ir a iniciar sesión',
  'setup.welcome': 'Bienvenido a KrakenOS',
  'setup.subtitle': 'Configura tu administrador para empezar.',
  'setup.defaultHomeName': 'Mi hogar',
  'setup.homeName': 'Nombre del hogar',
  'setup.displayName': 'Tu nombre',
  'setup.email': 'Email',
  'setup.password': 'Contraseña',
  'setup.confirm': 'Confirmar contraseña',
  'setup.token': 'Token de configuración',
  'setup.tokenHint':
    'Lo imprimió el agente en su log al arrancar (busca «Token de configuración»).',
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
  'login.error.tooManyAttempts': 'Demasiados intentos. Espera un minuto e inténtalo de nuevo.',
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

  // --- Entrar sin la contraseña (US-269) ---
  // La pantalla no mencionaba siquiera que hubiera salida, así que quien perdía la
  // contraseña se quedaba mirando un formulario. El texto nombra las tres vías
  // reales y no promete un correo de recuperación, que no existe.
  'login.recover.prompt': '¿No puedes entrar?',
  'login.recover.title': 'Entrar sin la contraseña',
  'login.recover.intro':
    'Si guardaste tus códigos de recuperación, usa uno para entrar y cambia la contraseña en Ajustes → Cuenta. Cada código sirve una sola vez.',
  'login.recover.submit': 'Entrar con el código',
  'login.recover.invalid': 'Correo o código incorrectos.',
  'login.recover.noCodes': '¿No tienes códigos?',
  'login.recover.noCodesHelp':
    'Otro administrador puede darte una contraseña nueva en Ajustes → Usuarios. Si eres el único administrador, hay que hacerlo desde el servidor: la guía de recuperación explica cómo.',
  'login.recover.back': 'Volver',

  // --- Pedir acceso al hogar (US-273) ---
  // No es autorregistro: no se crea nada hasta que un admin lo aprueba, y el texto
  // lo dice para no prometer una cuenta que quizá no llegue.
  'login.request.prompt': 'Solicitar acceso',
  'login.request.title': 'Pedir acceso al hogar',
  'login.request.intro':
    'Quien administra el hogar recibirá tu petición y decidirá si te da acceso. No se crea ninguna cuenta hasta entonces.',
  'login.request.name': 'Tu nombre',
  'login.request.note': 'Nota para quien administra (opcional)',
  'login.request.submit': 'Enviar solicitud',
  'login.request.sending': 'Enviando…',
  'login.request.sent':
    'Solicitud enviada. Si te dan acceso, recibirás un enlace para crear tu cuenta.',
  'login.request.error': 'No se pudo enviar la solicitud. Inténtalo de nuevo.',

  // --- Aceptar una invitación (US-272) ---
  'invite.checking': 'Comprobando la invitación…',
  'invite.title': 'Te han invitado a {home}',
  'invite.intro': 'Elige tu contraseña. No la verá nadie más, ni siquiera quien te invitó.',
  'invite.displayName': 'Tu nombre',
  'invite.password': 'Contraseña',
  'invite.confirm': 'Confirmar contraseña',
  'invite.submit': 'Crear mi cuenta',
  'invite.submitting': 'Creando la cuenta…',
  'invite.error.mismatch': 'Las contraseñas no coinciden.',
  'invite.error.short': 'La contraseña debe tener al menos 8 caracteres.',
  'invite.error.generic':
    'No se pudo aceptar la invitación. Puede que el enlace ya se haya usado o haya caducado.',
  'invite.invalid.title': 'Este enlace ya no sirve',
  'invite.invalid.body':
    'Las invitaciones caducan y solo se pueden usar una vez. Pide otra a quien administra el hogar.',
  'invite.goToLogin': 'Ir a iniciar sesión',

  // --- Portada pública (US-269) ---
  // Los tres reclamos son hechos comprobables del repositorio, no medidas de una
  // casa que quien lee todavía no tiene. En particular NO se dice «sin cuentas de
  // fabricante»: hay integraciones que las piden y la tabla de compatibilidad lo
  // declara, así que prometerlo aquí sería contradecir al propio sistema.
  'welcome.eyebrow': 'KrakenOS · Servidor doméstico',
  'welcome.title': 'Tu red deja de ser una caja negra.',
  'welcome.subtitle':
    'Quién se conecta, con quién habla, cuánto gasta y a qué hora se apaga. Todo se mide en tu casa y se guarda en tu disco.',
  'welcome.enter': 'Entrar',
  'welcome.createAdmin': 'Crear administrador',
  'welcome.needsSetupHint': 'Esta instalación todavía no tiene administrador.',
  'welcome.claim.local': 'Corre en tu casa',
  'welcome.claim.localDetail': 'El servidor es tuyo. Se entra por la red local o por VPN.',
  'welcome.claim.noFee': 'Sin suscripción',
  'welcome.claim.noFeeDetail': 'No hay plan de pago ni funciones detrás de una cuota.',
  'welcome.claim.source': 'Código abierto',
  'welcome.claim.sourceDetail': 'Licencia AGPL-3.0: puedes leer el código y modificarlo.',
} as const;

registrarFragmento(esEntrada);
