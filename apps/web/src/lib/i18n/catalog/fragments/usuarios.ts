import { registrarFragmento } from '../../registro';

/**
 * Fragmento «usuarios» del catálogo en español: viaja con las pantallas que lo usan,
 * no con el arranque. Quien pinte una clave de aquí importa este módulo
 * (`import '@/lib/i18n/catalog/fragments/usuarios';`): registrarlo antes del primer
 * render es lo que mantiene `t()` síncrono. Lo exige
 * `test/lib/catalogo-fragmentos.test.ts`.
 */
export const esUsuarios = {
  // --- Conectar (US-139) ---
  'users.add': 'Añadir usuario',
  'users.name': 'Nombre',
  'users.initialPass': 'Contraseña inicial',
  'users.expires': 'Caduca (invitado)',
  'users.loading': 'Cargando usuarios…',
  'users.col.user': 'Usuario',
  'users.col.role': 'Rol',
  'users.col.status': 'Estado',
  'users.col.lastLogin': 'Último acceso',
  'users.col.actions': 'Acciones',
  'users.roleOf': 'Rol de {email}',
  'users.roleUpdated': 'Rol actualizado',
  'users.active': 'Activo',
  'users.disabled': 'Deshabilitado',
  'users.disable': 'Deshabilitar',
  'users.enable': 'Habilitar',
  'users.wasDisabled': 'Usuario deshabilitado',
  'users.wasEnabled': 'Usuario habilitado',
  'users.password': 'Contraseña',
  'users.newPass': 'Nueva contraseña',
  'users.newPassOf': 'Nueva contraseña de {email}',
  'users.cannotDeleteSelf': 'No puedes eliminar tu propia cuenta',
  'users.created': 'Usuario {email} creado',
  'users.deleted': 'Usuario {email} eliminado',
  'users.passReset': 'Contraseña restablecida (se cerraron sus sesiones)',
  'users.loadError': 'No se pudieron cargar los usuarios',
  'users.createError': 'No se pudo crear el usuario',
  'users.patchError': 'No se pudo aplicar el cambio',
  'users.deleteError': 'No se pudo eliminar el usuario',
  'users.passResetError': 'No se pudo restablecer la contraseña',
  'users.addHint':
    'Da acceso a un familiar o a personal. «Observador» ve el estado pero no cambia nada.',
  'users.create': 'Crear usuario',
  'users.creating': 'Creando…',
  'users.you': '(tú)',
  'users.apiTokens': '{n} {unidad}',
  'users.apiToken.one': 'token de API',
  'users.apiToken.other': 'tokens de API',

  // --- Barrido de copy a pelo (componentes) ---
  'users.expiresAt': 'Caduca {date}',
  'users.neverLoggedIn': 'Nunca',
} as const;

registrarFragmento(esUsuarios);
