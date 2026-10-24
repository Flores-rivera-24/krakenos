import { registrarFragmento } from '../../registro';

/**
 * Fragmento «ajustes» del catálogo en español: viaja con las pantallas que lo usan,
 * no con el arranque. Quien pinte una clave de aquí importa este módulo
 * (`import '@/lib/i18n/catalog/fragments/ajustes';`): registrarlo antes del primer
 * render es lo que mantiene `t()` síncrono. Lo exige
 * `test/lib/catalogo-fragmentos.test.ts`.
 */
export const esAjustes = {
  // --- Navegación, foco y nombres accesibles ---
  'settings.sections': 'Secciones de ajustes',
  'settings.system.presenceNightHint': 'Vacío = desactivada',
  'settings.system.maintenanceWindowHint': 'Vacío = siempre',
  'settings.system.saveFor': 'Guardar: {field}',
  'security.sessionRevokeFor': 'Revocar la sesión creada {created}',
  'invitations.hideLink': 'Ocultar el enlace',
  'security.otherSessionsClosed': 'Se han cerrado las demás sesiones; esta sigue abierta',
  'security.otherSessionsError': 'No se pudieron cerrar las demás sesiones',
  'security.passkeys.loadError': 'No se pudieron cargar las passkeys.',
  'security.codes.remainingError': 'No se pudo comprobar cuántos códigos de recuperación quedan.',
  'security.sessions.loadError': 'No se pudieron cargar las sesiones.',
  'security.codes.regenerateError': 'No se pudieron regenerar los códigos de recuperación.',
  'security.passkey.deleteError': 'No se pudo eliminar la passkey.',
  'security.sessionRevokeError': 'No se pudo revocar la sesión.',
  'security.regen.error': 'No se pudieron regenerar las claves.',

  // --- Ajustes → Cuenta: modo de la interfaz (US-176) ---
  'settings.uiMode.title': 'Modo de la aplicación',
  'settings.uiMode.simple': 'Sencillo',
  'settings.uiMode.simpleDesc':
    'Solo lo cotidiano: dispositivos, hogar, WiFi y cámaras. Sin jerga técnica.',
  'settings.uiMode.advanced': 'Avanzado',
  'settings.uiMode.advancedDesc':
    'Todo, incluida la red avanzada (VPN, firewall, VLANs, QoS, DNS).',
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

  // --- Ajustes → Actualizaciones (US-116 / US-190) ---
  'settings.update.title': 'Actualizaciones',
  'settings.update.installed': 'Versión instalada',
  'settings.update.checking': 'Comprobando…',
  'settings.update.disabled':
    'Comprobación de actualizaciones desactivada. Actívala con {env} en el servidor.',
  'settings.update.available': 'Actualización disponible: {version}',
  'settings.update.upToDate': 'Estás al día.',
  'settings.update.checkedAgainst': 'Comprobado contra las releases de GitHub.',
  'settings.update.applyNow': 'Actualizar ahora',
  'settings.update.applying': 'Iniciando…',
  'settings.update.inProgress': 'Actualización en curso…',
  'settings.update.inProgressSince': 'Empezó a las {time}.',
  'settings.update.cancel': 'Cancelar actualización',
  'settings.update.cancelling': 'Cancelando…',
  'settings.update.cancelled': 'Actualización cancelada',
  'settings.update.cancelError': 'No se pudo cancelar la actualización',
  'settings.update.dockerHint':
    'En Docker el contenedor no puede auto-actualizarse. Usa este comando:',
  'settings.update.copyCommand': 'Copiar comando',
  'settings.update.copied': '¡Copiado!',
  'settings.update.maintenanceWindow': 'Ventana de mantenimiento: {window}',
  'settings.update.started': 'Actualización iniciada',
  'settings.update.error': 'No se pudo iniciar la actualización',
  'settings.update.lastOk': 'Última actualización correcta: {from} → {to}',
  'settings.update.lastRolledBack':
    'Última actualización revertida a {from} (la nueva versión falló).',
  'settings.update.lastFailed': 'La última actualización falló.',
  'settings.update.nodeTooOld':
    'Esta versión necesita Node {version} o superior y el sistema tiene uno anterior. Actualiza con <c>sudo bash scripts/install.sh --update</c>, que instala el Node necesario.',
  'settings.update.lastNodeTooOld':
    'La última actualización no se aplicó: la nueva versión necesita un Node más reciente. Actualiza con <c>sudo bash scripts/install.sh --update</c>.',

  // --- Ajustes → Salud del sistema (US-191) ---
  'settings.health.title': 'Salud del sistema',
  'settings.health.loading': 'Cargando métricas…',
  'settings.health.error': 'No se pudo cargar las métricas.',
  'settings.health.uptime': 'Tiempo activo',
  'settings.health.memory': 'Memoria del agente',
  'settings.health.heap': 'Heap de V8 (usado / reservado)',
  'settings.health.requests': 'Peticiones',
  'settings.health.errorRate': 'Tasa de error',
  'settings.health.latency': 'Latencia (media / p95)',
  'settings.health.inFlight': 'En curso',
  'settings.health.loopLag': 'Retraso del bucle',
  'settings.health.disk': 'Disco libre',
  'settings.health.dbSize': 'Base de datos',
  'settings.health.wsClients': 'Clientes en tiempo real',
  'settings.health.managers': 'Managers',
  'settings.health.noManagers': 'Aún sin muestras de manager.',
  'settings.health.opsCount.one': '{count} llamada',
  'settings.health.opsCount.other': '{count} llamadas',
  'settings.health.diskValue': '{free} · {pct}% usado',

  // --- Ajustes → Soporte y diagnóstico (US-192) ---
  'settings.support.title': 'Soporte y diagnóstico',
  'settings.support.telemetry': 'Telemetría anónima',
  'settings.support.telemetryDesc':
    'Recuentos agregados, sin datos personales. Desactivada por defecto; nunca sale de tu servidor salvo que compartas el paquete.',
  'settings.support.enable': 'Activar',
  'settings.support.disable': 'Desactivar',
  'settings.support.telemetryOn': 'Telemetría activada',
  'settings.support.telemetryOff': 'Telemetría desactivada',
  'settings.support.telemetryError': 'No se pudo cambiar la telemetría',
  'settings.support.counts': '{devices} dispositivos · {automations} automatizaciones',
  'settings.support.downloadDesc':
    'Un archivo con la configuración sanitizada (sin secretos ni datos personales) para diagnosticar problemas.',
  'settings.support.download': 'Descargar paquete de soporte',
  'settings.support.downloading': 'Generando…',
  'settings.feedback.title': 'Enviar feedback',
  'settings.feedback.desc':
    'Abre un aviso en GitHub con tu versión y modo de despliegue ya rellenados. Nada se envía solo: tú decides qué pegar, y puedes adjuntar el paquete de soporte (sin secretos ni datos personales).',
  'settings.feedback.bug': 'Reportar un problema',
  'settings.feedback.hardware': 'Informe de hardware',
  'settings.feedback.feature': 'Proponer una mejora',
  'settings.support.error': 'No se pudo generar el paquete de soporte',

  // --- Ajustes → Sistema → Acerca de (US-257) ---
  'settings.install.title': 'Instalar como app',
  'settings.install.desc':
    'Abre KrakenOS desde el escritorio, con su icono y en su propia ventana. El monitoreo sigue aunque la cierres.',
  'settings.install.button': 'Instalar app',
  'settings.install.toast': 'KrakenOS instalada como app',
  'settings.install.installed': 'KrakenOS ya está instalada como app en este dispositivo.',
  'settings.install.running': 'Estás usando KrakenOS como app, en su propia ventana.',
  'settings.install.ios':
    'En iPhone y iPad se instala desde el navegador: «Compartir» → «Añadir a pantalla de inicio».',
  'settings.install.insecure':
    'El navegador solo permite instalar la app sobre HTTPS. Mira la tarjeta «{tls}» de esta misma página para ver cómo activarlo.',
  'settings.install.unsupported':
    'Este navegador no ofrece la instalación desde aquí. Prueba con Edge o Chrome, o busca «Instalar» en el menú del navegador.',
  'settings.install.edgeTip':
    'Consejo: en Edge, desde edge://apps puedes hacer que KrakenOS se abra al iniciar sesión.',
  'settings.about.title': 'Acerca de KrakenOS',
  'settings.about.license': 'KrakenOS es software libre, publicado bajo la licencia {license}.',
  'settings.about.source': 'Ver el código fuente',
  'settings.about.licenseText': 'Leer la licencia',
  'settings.about.newTab': '{label} (se abre en una pestaña nueva)',
  'settings.about.copyleft':
    'Puedes usarlo en tu casa sin ninguna obligación. Si modificas KrakenOS y se lo ofreces a otras personas a través de la red, tienes que darles también tu código.',

  // --- Ajustes → Tokens de API (US-174) ---
  'settings.apiTokens.title': 'Tokens de API',
  'settings.apiTokens.desc':
    'Da acceso a Home Assistant, Node-RED u otras apps sin darles tu contraseña. Los tokens leen el estado y, opcionalmente, controlan dispositivos; nunca administran.',
  'settings.apiTokens.name': 'Nombre',
  'settings.apiTokens.namePlaceholder': 'p. ej. Home Assistant',
  'settings.apiTokens.scopes': 'Permisos',
  'settings.apiTokens.scopeView': 'Leer el estado del hogar',
  'settings.apiTokens.scopeControl': 'Controlar dispositivos',
  'settings.apiTokens.create': 'Crear token',
  'settings.apiTokens.creating': 'Creando…',
  'settings.apiTokens.error': 'No se pudo crear el token',
  'settings.apiTokens.copyHint': 'Copia este token ahora. No se volverá a mostrar.',
  'settings.apiTokens.none': 'Aún no tienes tokens.',
  'settings.apiTokens.revoke': 'Revocar',
  'settings.apiTokens.revoked': 'Token revocado',
  'settings.apiTokens.revokeError': 'No se pudo revocar el token',
  'settings.apiTokens.neverUsed': 'Sin usar',
  'settings.apiTokens.used': 'Último uso: {when}',

  // --- Ajustes → Publicar a MQTT (US-174) ---
  'settings.mqtt.title': 'Publicar a MQTT',
  'settings.mqtt.desc':
    'Publica el estado de tu hogar (IoT, energía) a un broker MQTT local para integrarlo con Home Assistant o Node-RED. La contraseña se guarda cifrada.',
  'settings.mqtt.enabled': 'Activar publicación',
  'settings.mqtt.url': 'Broker',
  'settings.mqtt.username': 'Usuario',
  'settings.mqtt.password': 'Contraseña',
  'settings.mqtt.passwordKeep': 'Déjalo en blanco para conservar la guardada.',
  'settings.mqtt.prefix': 'Prefijo de topics',
  'settings.mqtt.interval': 'Intervalo (s)',
  'settings.mqtt.discovery': 'Descubrimiento de Home Assistant',
  'settings.mqtt.discoveryDesc':
    'Publica las entidades para que Home Assistant las descubra solo (luces, enchufes, energía, modo del hogar, alarma). No incluye personas.',
  'settings.mqtt.control': 'Aceptar órdenes desde MQTT',
  'settings.mqtt.controlDesc':
    'Permite encender/apagar y atenuar tus dispositivos desde Home Assistant. Publicar estados no lo activa; es un permiso aparte.',
  'settings.mqtt.pauseControl': 'Permitir pausar internet desde MQTT',
  'settings.mqtt.pauseControlDesc':
    'Añade en Home Assistant un botón por dispositivo para cortarle internet 30 minutos. Es un permiso distinto del anterior: aquel permite tocar tus dispositivos, este permite dejar sin internet a alguien de casa. Cada uso queda en la auditoría.',
  'settings.mqtt.save': 'Guardar',
  'settings.mqtt.saving': 'Guardando…',
  'settings.mqtt.saved': 'Configuración MQTT guardada',
  'settings.mqtt.error': 'No se pudo guardar la configuración MQTT',
  'settings.mqtt.loadError':
    'No se pudo cargar la configuración de MQTT; no se puede guardar hasta leerla.',
  'settings.mqtt.connected': 'Conectado',
  'settings.mqtt.disconnected': 'Sin conectar',
  'settings.mqtt.lastError': 'Último error: {error}',

  // --- TLS de la instalación (US-241) ---
  'settings.tls.title': 'Conexión segura (HTTPS)',
  'settings.tls.on': 'Tu instalación se sirve por HTTPS.',
  'settings.tls.off': 'Tu instalación se sirve por HTTP, sin cifrar.',
  'settings.tls.behindProxy': 'el cifrado lo termina el proxy que tienes delante',
  'settings.tls.disabledTitle': 'Sin HTTPS hay funciones que el navegador no deja arrancar',
  'settings.tls.feature.pwa': 'Instalar KrakenOS como app en el móvil.',
  'settings.tls.feature.push': 'Recibir avisos en el móvil.',
  'settings.tls.feature.passkeys': 'Entrar con passkey (segundo factor).',
  'settings.tls.howTo':
    'No es un ajuste de la app: se resuelve al instalar. Vuelve a lanzar el instalador sin «--tls none»: usará Tailscale si lo tienes y, si no, una CA propia de KrakenOS.',
  'settings.tls.sourceLabel': 'Certificado',
  'settings.tls.source.tailscale': "Let's Encrypt (Tailscale)",
  'settings.tls.source.selfSigned': 'Autofirmado',
  'settings.tls.source.unknown': 'Desconocido',
  'settings.tls.expiresLabel': 'Caduca',
  'settings.tls.daysLeft': '(quedan {n} días)',
  'settings.tls.expiringTitle': 'El certificado va a caducar',
  'settings.tls.expiringDesc':
    'Quedan {n} días. Si se renueva solo, KrakenOS lo aplicará sin reiniciar; si no, vuelve a emitirlo antes de esa fecha o nadie podrá entrar.',
  'settings.tls.expiredTitle': 'El certificado ha caducado',
  'settings.tls.expiredDesc':
    'Los navegadores ya están rechazando la conexión. Emite uno nuevo: KrakenOS lo detecta y lo aplica sin reiniciar.',
  'settings.tls.selfSignedNote':
    'Al ser autofirmado, cada dispositivo avisará de «sitio no seguro» hasta que instales la CA en él.',
  'settings.tls.source.localCa': 'CA local de KrakenOS',
  'settings.tls.ca.title': 'Instala el certificado en cada dispositivo',
  'settings.tls.ca.intro':
    'Cada móvil u ordenador debe confiar una vez en la CA de KrakenOS. Descarga el certificado y sigue los pasos de tu sistema.',
  'settings.tls.ca.download': 'Descargar certificado',
  'settings.tls.ca.scope':
    'Esta CA solo puede avalar nombres «.local», «localhost» y direcciones privadas: aunque alguien se hiciera con ella, no serviría para suplantar un sitio de internet.',
  'settings.tls.ca.os.windows': 'Windows',
  'settings.tls.ca.os.macos': 'macOS',
  'settings.tls.ca.os.android': 'Android',
  'settings.tls.ca.os.ios': 'iPhone y iPad',
  'settings.tls.ca.windows.1':
    'Abre el archivo krakenos-ca.crt que has descargado y pulsa «Instalar certificado».',
  'settings.tls.ca.windows.2': 'Elige «Equipo local» (o «Usuario actual») y pulsa «Siguiente».',
  'settings.tls.ca.windows.3':
    'Elige «Colocar todos los certificados en el siguiente almacén», pulsa «Examinar» y selecciona «Entidades de certificación raíz de confianza».',
  'settings.tls.ca.windows.4':
    'Termina el asistente, acepta el aviso de seguridad y reinicia el navegador.',
  'settings.tls.ca.macos.1': 'Abre el archivo krakenos-ca.crt: se añade a «Acceso a Llaveros».',
  'settings.tls.ca.macos.2':
    'En «Acceso a Llaveros», busca «KrakenOS CA local» y abre su ficha con doble clic.',
  'settings.tls.ca.macos.3':
    'Despliega «Confiar», elige «Confiar siempre» y cierra la ventana con tu contraseña.',
  'settings.tls.ca.android.1':
    'Descarga el certificado y ve a Ajustes → Seguridad → Cifrado y credenciales → Instalar un certificado → Certificado de CA.',
  'settings.tls.ca.android.2': 'Acepta el aviso de seguridad y elige el archivo krakenos-ca.crt.',
  'settings.tls.ca.android.3':
    'Reinicia el navegador. Los nombres de los menús cambian según el fabricante.',
  'settings.tls.ca.ios.1':
    'Descarga el certificado desde Safari y pulsa «Permitir» cuando pregunte si quieres descargar un perfil de configuración.',
  'settings.tls.ca.ios.2': 'Abre Ajustes → «Perfil descargado» e instálalo.',
  'settings.tls.ca.ios.3':
    'Es el paso que más se olvida: ve a Ajustes → General → Información → Confianza de certificados y activa «KrakenOS CA local». Sin él el perfil queda instalado, pero iOS no confía en él.',
  'settings.tls.ca.firefox':
    'Firefox usa su propio almacén de certificados: si lo usas, impórtalo también en Ajustes → Privacidad y seguridad → Certificados.',

  // --- Conectar (US-139) ---
  // Alertas (US-270). Las etiquetas de evento vivían en el AGENTE, que no tiene
  // i18n, y viajaban dentro de la respuesta de la API: la app en inglés enseñaba
  // las trece filas en español. Ahora la API manda la clave y el copy está aquí.
  'alerts.title': 'Alertas',
  'alerts.intro':
    'Elige qué eventos de seguridad te avisan y por qué canal. El email requiere SMTP y Telegram un bot (TELEGRAM_*) configurados en el servidor.',
  'alerts.col.event': 'Evento',
  'alerts.col.push': 'Push',
  'alerts.col.email': 'Email',
  'alerts.col.telegram': 'Telegram',
  'alerts.loadError': 'No se pudieron cargar las alertas',
  'alerts.toggleError': 'No se pudo cambiar la alerta',
  'alerts.unknownEvent': 'Evento no reconocido por esta versión',
  'alerts.aria.push': 'Push: {event}',
  'alerts.aria.email': 'Email: {event}',
  'alerts.aria.telegram': 'Telegram: {event}',
  'alertEvent.auth.loginFailed': 'Login fallido',
  'alertEvent.auth.loginLocked': 'Cuenta bloqueada',
  'alertEvent.auth.refreshReuse': 'Posible robo de sesión',
  'alertEvent.auth.recoveryUsed': 'Acceso con código de recuperación',
  'alertEvent.device.block': 'Dispositivo bloqueado',
  'alertEvent.inventory.unknownDevice': 'Dispositivo desconocido',
  'alertEvent.dns.newDestination': 'Un aparato contacta con un destino nuevo',
  'alertEvent.energy.threshold': 'Consumo eléctrico anómalo',
  'alertEvent.camera.motion': 'Movimiento detectado',
  'alertEvent.alarm.triggered': '¡Alarma disparada!',
  'alertEvent.alarm.smoke': '¡Humo detectado!',
  'alertEvent.alarm.co': '¡Monóxido de carbono detectado!',
  'alertEvent.alarm.sensorFault': 'Sensor de alarma caído',
  'alertEvent.alarm.disarmDenied': 'PIN de alarma incorrecto',
  'alertEvent.system.tlsExpiring': 'El certificado HTTPS va a caducar',
  'reports.title': 'Informes (CSV)',
  'reports.intro': 'Exporta tus datos para una revisión mensual o para un auditor.',
  'reports.generateError': 'No se pudo generar el informe',
  'backup.title': 'Copia de seguridad',
  'backup.intro':
    'Descarga un archivo cifrado con todo lo importante: la base de datos, las claves y los datos de tus integraciones. Guárdalo en un lugar seguro — necesitarás esta contraseña para restaurarlo, y sin ella el archivo es irrecuperable.',
  'backup.pass': 'Contraseña de la copia',
  'backup.confirm': 'Confirmar contraseña de la copia',
  'backup.restore': 'Restaurar',
  'backup.file': 'Archivo de copia',
  'backup.replaceTitle': 'Esto sustituye tus datos actuales',
  'backup.replaceBody':
    'Restaurar reemplaza la base de datos, las claves y las credenciales por las de la copia. Lo actual se respalda antes, pero todo lo que hayas hecho desde esa copia se pierde. Se aplica al reiniciar el agente.',
  'backup.typeToConfirm': 'Para continuar, escribe',
  'backup.passMismatch': 'Las contraseñas no coinciden',
  'backup.downloaded': 'Copia de seguridad descargada',
  'backup.restorePrepared':
    'Restauración preparada ({staged} ficheros). Reinicia el agente para aplicarla.',
  'backup.restoreError': 'No se pudo restaurar',
  'backup.auto.title': 'Copias automáticas',
  'backup.auto.freq': 'Frecuencia',
  'backup.auto.off': 'Desactivadas',
  'backup.auto.daily': 'Cada día',
  'backup.auto.weekly': 'Cada semana',
  'backup.auto.keep': 'Copias que se conservan',
  'backup.auto.reveal': 'Ver contraseña',
  'backup.auto.passGenerated': 'Contraseña generada',
  'backup.generating': 'Generando…',
  'backup.download': 'Descargar copia de seguridad',
  'backup.generateError': 'No se pudo generar la copia',
  'backup.preparing': 'Preparando…',
  'backup.restoreAction': 'Restaurar copia',
  'backup.settingError': 'No se pudo guardar el ajuste',
  'backup.opError': 'No se pudo completar la operación',
  'backup.auto.passGen': 'Generar contraseña',
  'backup.auto.passRegen': 'Generar otra contraseña',
  // La palabra que hay que teclear para confirmar. Va en el catálogo porque se
  // **enseña** y se **compara**: cableada en español, a quien usa la app en
  // inglés se le pedía escribir «RESTAURAR».
  'backup.confirmWord': 'RESTAURAR',
  // `<b>`/`<c>` los interpreta `RichText`: el énfasis cae en mitad de la frase y
  // partirla en trozos la dejaría intraducible.
  'backup.restoreHint':
    'Sube un archivo de copia y su contraseña. Se valida y se prepara; se aplica al <b>reiniciar</b> el agente (se respalda lo actual por si acaso).',
  'backup.auto.hint':
    'KrakenOS puede guardar una copia cifrada en <c>data/backups/</c> cada día o cada semana, a las 03:00. Necesita una contraseña propia (nadie va a teclearla de madrugada).',
  'backup.auto.created': 'Copia creada',
  'backup.auto.running': 'Copiando…',
  'backup.auto.runNow': 'Copiar ahora',
  'backup.auto.keepPassTitle': 'Guarda esta contraseña fuera del servidor',
  'backup.auto.keepPassBody':
    'Sin ella, las copias automáticas no se pueden restaurar. Y de nada sirve guardarla en el mismo aparato que quieres poder recuperar: llévate también las copias a otro sitio.',
  'backup.auto.none': 'Todavía no hay ninguna copia automática.',
  'backup.auto.copy': 'copia',
  'backup.auto.copies': 'copias',
  'backup.auto.summary': '{n} {unidad} en disco · {size} · última: {last}',
  'backup.auto.staleTitle': 'No hay una copia reciente',
  'backup.auto.staleBody':
    'Las copias automáticas están activadas, pero la última es demasiado antigua (o no hay ninguna). Revisa que haya contraseña configurada y espacio en disco.',
  'backup.auto.failedTitle': 'La última copia automática falló',
  'security.title': 'Seguridad',
  'security.passkeys': 'Passkeys',
  'security.passkey.unsupported': 'Tu navegador no admite passkeys.',
  'security.passkey.name': 'Nombre para esta passkey',
  'security.passkey.namePlaceholder': 'MacBook, iPhone, YubiKey…',
  'security.passkey.register': 'Registrar',
  'security.passkey.registering': 'Registrando…',
  'security.passkey.add': 'Añadir passkey',
  'security.passkey.registerError': 'No se pudo registrar la passkey.',
  'security.codes.title': 'Códigos de recuperación',
  'security.codes.remaining': 'te quedan {n}',
  'security.codes.help':
    'Permiten entrar si pierdes tu passkey. Regenerar invalida los anteriores.',
  'security.codes.regenerate': 'Regenerar códigos',
  'security.codes.regenerating': 'Generando…',
  'security.codes.reveal':
    'Guarda estos códigos de recuperación en un lugar seguro. Cada uno sirve una vez para entrar si pierdes tu passkey.',
  'security.codes.onceOnly': 'No se volverán a mostrar.',
  'security.codes.saved': 'Los he guardado',
  'security.tokenTtl': 'Duración del access token',
  'security.loginLimit': 'Límite de intentos de login',
  'security.darkTheme': 'Tema oscuro',
  'security.sessions': 'Sesiones activas',
  'security.noSessions': 'Sin sesiones activas.',
  'security.danger': 'Zona de peligro',
  'security.regen.warning': 'Regenerar las claves RS256 cerrará todas las sesiones activas.',
  'security.regen.button': 'Regenerar claves RS256',
  'security.regen.confirmTitle': '¿Regenerar las claves RS256?',
  'security.regen.confirmBody':
    'Esto cerrará todas las sesiones activas (incluida la tuya) y tendrás que volver a iniciar sesión. Esta acción no se puede deshacer.',
  'security.regen.confirm': 'Sí, regenerar',
  'requests.title': 'Solicitudes de acceso',
  'requests.hint':
    'Han pedido entrar desde la pantalla de acceso. Aprobar no crea la cuenta: genera un enlace para que elijan su propia contraseña.',
  'requests.roleFor': 'Rol para {name}',
  'requests.approve': 'Aprobar',
  'requests.reject': 'Rechazar',
  'requests.rejected': 'Solicitud rechazada',
  'requests.decideError': 'No se pudo decidir la solicitud',
  'invitations.title': 'Invitaciones',
  'invitations.empty': 'Sin invitaciones.',
  'invitations.inviteTitle': 'Invitar a alguien',
  'invitations.inviteHint':
    'Se genera un enlace de un solo uso. La contraseña la elige quien lo abre, así que no tienes que teclearla tú ni mandarla por ningún chat.',
  'invitations.email': 'Correo electrónico',
  'invitations.create': 'Crear invitación',
  'invitations.freshTitle': 'Comparte este enlace',
  'invitations.freshBody':
    'Solo se puede usar una vez y caduca en 24 horas. <b>No se puede volver a ver</b>: solo se guarda su huella, así que si lo pierdes tendrás que emitir otro.',
  'invitations.meta': '{role} · {estado}',
  'invitations.usedAgo': 'Usada {when}',
  'invitations.expiresAgo': 'Caduca {when}',
  'invitations.status.pending': 'Pendiente',
  'invitations.status.used': 'Usada',
  'invitations.status.expired': 'Caducada',
  'invitations.revoke': 'Revocar',
  'invitations.remove': 'Quitar',
  'invitations.created': 'Invitación creada para {email}',
  'invitations.revoked': 'Invitación revocada',
  'invitations.approved': 'Acceso aprobado. Comparte el enlace con {name}',
  'invitations.loadError': 'No se pudieron cargar las invitaciones',
  'invitations.createError': 'No se pudo crear la invitación',
  'invitations.revokeError': 'No se pudo revocar la invitación',
  'invitations.copyError': 'No se pudo copiar. Selecciona el enlace y cópialo a mano',
  'tuya.name': 'Nombre',
  'tuya.version': 'Versión',
  'tuya.unchanged': 'sin cambios',
  'tuya.col.status': 'Estado',
  'tuya.deleteQ': '¿Eliminar?',
  'tuya.empty': 'Sin focos Tuya registrados.',
  'tuya.loadError': 'No se pudieron cargar los focos Tuya.',
  'tuya.add': 'Añadir foco',
  'tuya.opError': 'No se pudo completar la operación',
  'integrations.online': '{online}/{total} en línea',
  'integrations.undetected': 'No detectada',
  'integrations.connect': 'Cómo conectar',
  'integrations.loadError': 'No se pudo comprobar qué integraciones están conectadas.',
  'integrations.unknown': 'No se pudo comprobar',
  'integrations.hue.relink': 'Pulsa el botón del bridge para re-vincular.',
  'integrations.govee.hint': 'Activa «LAN Control» en la app Govee.',
  'integrations.tuya.hide': 'Ocultar focos',
  'integrations.tuya.manage': 'Gestionar focos',
  'integrations.tuya.bulbs': 'Focos Tuya',
  'weather.title': 'Tiempo exterior',
  'weather.intro':
    'Permite que tus rutinas reaccionen al tiempo: «si la temperatura baja de 5 °C, enciende la calefacción».',
  'weather.consent.title': 'Esto envía la ubicación de tu casa',
  'weather.consent.body':
    'Para saber el tiempo hay que decir <b>dónde</b>. Con esto activado, KrakenOS consulta <c>{provider}</c>, un servicio externo. Es la única función que manda un dato del hogar fuera; todo lo demás se queda aquí.',
  'weather.noLocation':
    'Todavía no has indicado dónde está la casa. Configúrala en Ajustes → Sistema para poder usar el tiempo en tus rutinas.',
  'weather.useInRoutines': 'Usar el tiempo en las rutinas',
  'weather.onHint': 'Activado. Se consulta una vez por hora.',
  'weather.offHint': 'Desactivado. No se hace ninguna petición.',
  'weather.enable': 'Activar',
  'weather.disable': 'Desactivar',
  'weather.precision': 'Precisión de la ubicación',
  'weather.precision.rounded': 'Aproximada (recomendado)',
  'weather.precision.roundedHint':
    'Redondea a unos 11 km. El tiempo es el mismo y no señala tu casa.',
  'weather.precision.exact': 'Exacta',
  'weather.precision.exactHint': 'Envía las coordenadas tal cual las tienes guardadas.',
  'weather.sentExactly': 'Se envía exactamente:',
  'weather.loadError': 'No se pudo cargar el tiempo exterior.',
  'weather.saveError': 'No se pudo guardar el ajuste.',
  'password.title': 'Cambiar contraseña',
  'password.submit': 'Cambiar contraseña',
  'password.current': 'Contraseña actual',
  'password.new': 'Nueva contraseña',
  'password.confirm': 'Confirmar nueva contraseña',
  'password.mismatch': 'La nueva contraseña y su confirmación no coinciden.',
  'password.updated': 'Contraseña actualizada',
  'password.error': 'No se pudo cambiar la contraseña',
  'security.passkey.empty':
    'Sin passkeys registradas. Añade una para activar verificación en dos pasos al iniciar sesión.',
  // Las dos formas van completas y NO se concatenan: en otro idioma «usada» y
  // «sin uso» no caen detrás de la fecha.
  'security.passkey.metaUsed': '{type} · creada {created} · usada {used}',
  'security.passkey.metaUnused': '{type} · creada {created} · sin uso',
  'security.perMinute': '{n} por minuto',
  'security.closeAllSessions': 'Cerrar las demás sesiones',

  // --- Ajustes (US-47) ---
  'settings.title': 'Ajustes',
  'settings.subtitle': 'Configuración del sistema y de tu cuenta.',
  'settings.applied': 'Cambio aplicado al instante (sin reiniciar).',
  'settings.saveError': 'No se pudo guardar el cambio. Revisa la conexión e inténtalo de nuevo.',
  // Secciones (barra lateral)
  'settings.section.system': 'Sistema',
  'settings.section.network': 'Red',
  'settings.section.security': 'Seguridad',
  'settings.section.integrations': 'Integraciones',

  // --- Puente Matter (US-171) ---
  'settings.section.users': 'Usuarios',
  'settings.section.account': 'Cuenta',
  // Tarjeta Sistema
  'settings.system.title': 'Sistema',
  'settings.system.homeName': 'Nombre del hogar',
  'settings.system.save': 'Guardar',
  'settings.system.timezone': 'Zona horaria',
  'settings.system.scanInterval': 'Intervalo de escaneo',
  'settings.system.sec30': '30 segundos',
  'settings.system.min1': '1 minuto',
  'settings.system.min5': '5 minutos',
  'settings.system.min10': '10 minutos',
  'settings.system.min20': '20 minutos',
  'settings.system.min30': '30 minutos',
  'settings.system.presenceGrace': 'Gracia de presencia',
  'settings.system.presenceGraceAria': 'Ventana de gracia de la presencia',
  'settings.system.presenceSweeps': 'Confirmación de salida (barridos)',
  'settings.system.presenceSweepsAria': 'Barridos consecutivos para confirmar una salida',
  'settings.system.presenceNight': 'Supresión nocturna de salidas',
  'settings.system.presenceNightPlaceholder': 'p. ej. 23:00-07:00',
  'settings.system.maintenanceWindow': 'Ventana de mantenimiento',
  'settings.system.maintenanceWindowPlaceholder': 'p. ej. 02:00-06:00',
  'settings.system.https': 'HTTPS',
  'settings.system.httpsOn': 'Activado (certificado en LAN)',
  'settings.system.httpsOff': 'Desactivado (HTTP)',
  // Tarjeta Notificaciones
  'settings.notifications.title': 'Notificaciones',
  'settings.notifications.unsupported': 'Tu navegador no admite notificaciones push.',
  'settings.notifications.push': 'Notificaciones push',
  'settings.notifications.on': 'Activadas',
  'settings.notifications.off': 'Desactivadas',
  'settings.notifications.digest': 'Resumen del hogar',
  'settings.notifications.digestOff': 'Apagado',
  'settings.notifications.digestDaily': 'Diario (08:00)',
  'settings.notifications.digestWeekly': 'Semanal (lunes 08:00)',
  // Tarjeta Driver activo
  'settings.driver.title': 'Driver activo',
  'settings.driver.driver': 'Driver',
  'settings.driver.host': 'Host',
  'settings.driver.testing': 'Probando…',
  'settings.driver.test': 'Probar conexión',
  'settings.driver.ok': 'OK · {latency} ms',
  // Tarjeta Retención de datos
  'settings.retention.title': 'Retención de datos',
  'settings.retention.traffic': 'Historial de tráfico',
  'settings.retention.trafficAria': 'Retención del historial de tráfico',
  'settings.retention.audit': 'Registro de auditoría',
  'settings.retention.auditAria': 'Retención del registro de auditoría',
  'settings.retention.d7': '7 días',
  'settings.retention.d30': '30 días',
  'settings.retention.d90': '90 días',
  'settings.retention.d180': '180 días',
  // Tarjeta Cuenta
  'settings.account.title': 'Cuenta',
  'settings.account.name': 'Nombre',
  'settings.account.email': 'Email',
  'settings.account.role': 'Rol',
  // Tarjeta Registro de auditoría
  'settings.audit.title': 'Registro de auditoría',
  'settings.audit.empty': 'Sin actividad registrada.',
  'settings.audit.colAction': 'Acción',
  'settings.audit.colIp': 'IP',
  'settings.audit.colWhen': 'Cuándo',

  // --- Barrido de copy a pelo (componentes) ---
  'reports.devices': 'Dispositivos',
  'reports.traffic': 'Tráfico (semana)',
  'reports.audit': 'Auditoría',
  'reports.generating': 'Generando…',
  'security.passkey.cancelled': 'Registro cancelado.',
  'security.ttl.15m': '15 minutos',
  'security.ttl.1h': '1 hora',
  'security.ttl.8h': '8 horas',
  'security.sessionMeta': 'Creada {created} · expira {expires}',
  'security.sessionRevoke': 'Revocar',
} as const;

registrarFragmento(esAjustes);
