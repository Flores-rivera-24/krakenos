/**
 * Catálogo en español del **arranque** — las claves que usa el bundle inicial
 * (navegación, layout, splash, toasts, estado de conexión) y las transversales que
 * casi toda pantalla pinta (`common`, `ui`, `errors`, `day`…).
 *
 * ⚠️ **Aquí NO se añade copy de una pantalla.** Cada kB de este fichero viaja en la
 * carga inicial de TODAS las pantallas. El copy de una pantalla va en su fragmento
 * (`./fragments/<pantalla>.ts`), que viaja con el chunk perezoso que lo usa. Lo
 * vigila `test/lib/catalogo-fragmentos.test.ts`. Los fragmentos y este núcleo se
 * recomponen en `./es.ts` (la fuente completa, que solo importan los tipos y los
 * tests, nunca el código de la app).
 */
export const esCore = {
  // --- Navegación (US-163) ---
  'nav.connect': 'Conectar',
  'nav.dashboard': 'Dashboard',
  'nav.devices': 'Dispositivos',
  'nav.wifi': 'Red WiFi',
  'nav.coverage': 'Cobertura WiFi',
  'nav.traffic': 'Tráfico',
  'nav.people': 'Personas',
  'nav.rooms': 'Habitaciones',
  'nav.scenes': 'Escenas',
  'nav.automations': 'Rutinas',
  'nav.iot': 'IoT',
  'nav.energy': 'Energía',
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
  'common.dismiss': 'Descartar',
  'common.trend': 'Tendencia',
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

  // --- Navegación, foco y nombres accesibles ---
  'layout.badge.devices.one': '{n} dispositivo desconocido o bloqueado',
  'layout.badge.devices.other': '{n} dispositivos desconocidos o bloqueados',
  'layout.badge.firewall.one': '{n} regla activa',
  'layout.badge.firewall.other': '{n} reglas activas',
  'layout.badge.iot.one': '{n} dispositivo IoT desconectado',
  'layout.badge.iot.other': '{n} dispositivos IoT desconectados',

  // --- Errores (US-93 / US-177) ---
  // `errors.network` lo genera el frontend (fetch rechazada). Los `errors.code.*`
  // traducen errores del agente por su `code`; en español el agente ya responde
  // en español, así que solo se usan cuando el idioma activo no es `es`.
  'errors.network': 'No se pudo conectar con el servidor. Revisa tu conexión.',
  'errors.code.AUTH_INVALID_CREDENTIALS': 'Credenciales incorrectas.',
  'errors.code.RATE_LIMITED': 'Demasiados intentos. Espera un momento e inténtalo de nuevo.',
  'errors.code.VALIDATION': 'Revisa los datos e inténtalo de nuevo.',
  'errors.code.CAMERAS_CONFIG_CORRUPT':
    'El fichero de cámaras está dañado. Restáuralo desde una copia de seguridad o revísalo a mano; no se ha modificado.',
  'errors.code.BACKUP_FROM_NEWER_VERSION':
    'Esta copia es de una versión más nueva de KrakenOS. Actualiza KrakenOS a la versión que la hizo, o a una más reciente, y vuelve a restaurarla. No se ha cambiado nada.',
  'errors.code.SETUP_ALREADY_DONE': 'El sistema ya está configurado',
  'errors.code.SETUP_LOCK_STALE':
    'La configuración quedó bloqueada por un intento anterior. Reinicia el agente y vuelve a intentarlo.',
  // Puerta de enlace (VPN, cortafuegos y QoS): el copy del agente, verbatim.
  'errors.code.GATEWAY_UNSUPPORTED':
    'Este equipo no puede hacer de puerta de enlace (VPN, cortafuegos o QoS). Usa los de tu router.',
  'errors.code.GATEWAY_REQUIRES_SETUP':
    'Falta instalar el helper de puerta de enlace en este equipo: sin él no se puede aplicar el cambio.',
  'errors.code.PRIVILEGED_COMMAND_FAILED':
    'No se pudo aplicar el cambio en el sistema. El detalle está en el registro del servidor.',
  // Cámaras RTSP sin ffmpeg: el agente manda el copy con el paso concreto; esto es la parte fija.
  'errors.code.FFMPEG_REQUIRES_SETUP':
    'Las cámaras RTSP necesitan ffmpeg y no está disponible en este equipo. Instálalo y reinicia el servicio.',
  // Dominio sin conectar (instalación nueva): el copy del agente, verbatim.
  'errors.code.DOMAIN_NOT_CONFIGURED':
    'Este apartado todavía no está conectado. Conéctalo en «Conectar» para poder hacer cambios.',

  // --- Escenas (US-166) ---
  'scenes.icon.night': 'Buenas noches',
  'scenes.icon.movie': 'Cine',
  'scenes.icon.leave': 'Salir de casa',

  // --- Bienestar digital (US-184) ---
  // Estado de cada dominio: sin conectar (instalación nueva) o de demostración.
  'domain.notConfigured.title': 'Sin configurar',
  'domain.notConfigured.driver':
    'Todavía no has conectado tu router: no hay dispositivos ni redes que enseñar.',
  'domain.notConfigured.vpn': 'Todavía no has configurado la VPN de este equipo.',
  'domain.notConfigured.iot': 'Todavía no has conectado ningún dispositivo inteligente.',
  'domain.notConfigured.cameras': 'Todavía no has conectado ninguna cámara.',
  'domain.notConfigured.firewall': 'Todavía no has configurado el cortafuegos de este equipo.',
  'domain.notConfigured.vlan': 'Todavía no has conectado un switch gestionado.',
  'domain.notConfigured.qos': 'Todavía no has configurado el QoS de este equipo.',
  'domain.notConfigured.dns': 'Todavía no has conectado un bloqueador de DNS.',
  'domain.demo.title': 'Datos de demostración',
  'domain.demo.body': 'Lo que ves aquí es de ejemplo, no de tu casa.',
  'domain.connectLink': 'Ir a Conectar',
  'layout.driver.connected': 'Conectado',
  'layout.driver.demo': 'Demostración',

  // --- Personas (US-240) ---
  'people.role.admin': 'Administrador',
  'people.role.member': 'Miembro',
  'people.role.kid': 'Menor',
  'people.role.guest': 'Invitado',
  'people.role.viewer': 'Observador',
  'people.role.unknown': 'Rol no reconocido ({role})',
  // Las tres formas de cortar internet (US-240)
  'access.kinds.title': 'Las tres formas de cortar internet',
  'access.kinds.pause': 'Pausa',
  'access.kinds.pauseDesc': 'Corte de un toque. Vuelve solo al cumplirse los minutos que elijas.',
  'access.kinds.schedule': 'Horario',
  'access.kinds.scheduleDesc':
    'Ventana que se repite cada semana. Vuelve solo cuando termina la ventana.',
  'access.kinds.block': 'Bloqueo',
  'access.kinds.blockDesc':
    'Corte indefinido de un dispositivo. Solo vuelve cuando alguien lo desbloquea.',
  'access.kinds.note': 'Son independientes y se suman: mientras quede una activa, no hay internet.',

  // --- Conectar (US-139) ---
  // Días de la semana (US-270). Dos formas: corta para listas, inicial para las
  // siete casillas de una semana. Vivían como dos constantes en español en dos
  // módulos distintos, así que Rutinas, Personas, la hora de dormir y la ventana
  // de las cámaras enseñaban los días en español con la app en inglés.
  'day.short.0': 'Dom',
  'day.short.1': 'Lun',
  'day.short.2': 'Mar',
  'day.short.3': 'Mié',
  'day.short.4': 'Jue',
  'day.short.5': 'Vie',
  'day.short.6': 'Sáb',
  'day.initial.0': 'D',
  'day.initial.1': 'L',
  'day.initial.2': 'M',
  'day.initial.3': 'X',
  'day.initial.4': 'J',
  'day.initial.5': 'V',
  'day.initial.6': 'S',
  'day.long.0': 'Domingo',
  'day.long.1': 'Lunes',
  'day.long.2': 'Martes',
  'day.long.3': 'Miércoles',
  'day.long.4': 'Jueves',
  'day.long.5': 'Viernes',
  'day.long.6': 'Sábado',
  'sun.sunrise': 'Amanecer',
  'sun.sunset': 'Atardecer',
  'sun.withOffset': '{base} {sign}{min} min',
  'rooms.select.label': 'Habitación',
  'rooms.select.none': 'Sin habitación',
  'common.save': 'Guardar',
  'common.saving': 'Guardando…',
  'common.saveChanges': 'Guardar cambios',
  'common.saveError': 'No se pudo guardar',
  'common.cancel': 'Cancelar',
  'access.startTime': 'Hora de inicio',
  'access.endTime': 'Hora de fin',
  'device.block': 'Bloquear acceso a la red',
  'device.unblock': 'Desbloquear acceso a la red',
  'common.loading': 'Cargando…',
  'common.delete': 'Eliminar',
  'common.confirm': 'Confirmar',
  'common.optional': 'opcional',
  'common.copy': 'Copiar',
  'common.copied': 'Copiado',
  'common.yes': 'Sí',
  'common.no': 'No',
  'common.edit': 'Editar',

  // --- Glosario (US-144/150) ---
  'glossary.whatIs': '¿Qué es {term}?',
  // Primitivas de `components/ui/` (US-239). Estaban en español a pelo, así que
  // sonaban en castellano en el 100 % de las pantallas en inglés.
  'ui.loading': 'Cargando…',
  'ui.copy': 'Copiar',
  'ui.retry': 'Reintentar',
  'ui.loadFailed': 'No se pudo cargar.',
  'ui.loadFailedWhat': 'No se pudo cargar {what}.',
  'ui.moreInfo': 'Más información',
  'ui.status.online': 'En línea',
  'ui.status.offline': 'Desconectado',
  'ui.status.warning': 'Advertencia',
  'ui.status.danger': 'Error',
  'ui.favorite.add': 'Fijar como favorito',
  'ui.favorite.remove': 'Quitar de favoritos',
  'ui.favorite.failed': 'No se pudo actualizar favoritos',
  'ui.switch.failed': 'No se pudo aplicar el cambio',
  'ui.confirm': 'Confirmar',
  'ui.cancel': 'Cancelar',

  // --- Barrido de copy a pelo (componentes) ---
  'nav.skipToContent': 'Saltar al contenido',
  'theme.switchToLight': 'Cambiar a modo claro',
  'theme.switchToDark': 'Cambiar a modo oscuro',
  'theme.light': 'Modo claro',
  'theme.dark': 'Modo oscuro',
  'connection.live': 'En tiempo real',
  'connection.reconnecting': 'Reconectando…',
  'connection.offline': 'Sin conexión',
  'ui.copied': '¡Copiado!',
  'ui.favorite.pinned': 'Fijado: {label}',
  'ui.favorite.unpinned': 'Quitado de favoritos: {label}',
  'ui.favorite.removeAria': 'Quitar {label} de favoritos',
  'ui.favorite.addAria': 'Fijar {label} como favorito',
} as const;
