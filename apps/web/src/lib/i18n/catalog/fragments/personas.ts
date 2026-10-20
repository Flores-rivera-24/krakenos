import { registrarFragmento } from '../../registro';

/**
 * Fragmento «personas» del catálogo en español: viaja con las pantallas que lo usan,
 * no con el arranque. Quien pinte una clave de aquí importa este módulo
 * (`import '@/lib/i18n/catalog/fragments/personas';`): registrarlo antes del primer
 * render es lo que mantiene `t()` síncrono. Lo exige
 * `test/lib/catalogo-fragmentos.test.ts`.
 */
export const esPersonas = {
  // --- Personas (US-240) ---
  'people.title': 'Personas',
  'people.subtitle':
    'El control parental por persona: lo que hagas aquí se aplica a todos sus dispositivos.',
  'people.loadError': 'No se pudo cargar la lista de personas',
  'people.onlyYou':
    'Solo ves tus dispositivos. El resto del hogar lo administran las personas con rol de administrador.',
  'people.empty': 'Todavía no hay dispositivos asignados a personas.',
  'people.emptyHint':
    'Abre un dispositivo en «Dispositivos» y asígnale un dueño; aquí aparecerá agrupado por persona.',
  'people.unassigned': 'Sin asignar',
  'people.withoutOwner': 'sin dueño',
  'people.noDevices': 'Sin dispositivos asignados.',
  'people.device.one': 'dispositivo',
  // Un aparato sin etiqueta ni hostname: el agente manda `null`, no un nombre inventado.
  'people.device.unnamed': 'Dispositivo sin nombre',
  'people.device.other': 'dispositivos',
  'people.onlineCount': '{n} en línea',
  'people.blockedCount': '{n} sin internet',
  'people.reason.manual': 'Bloqueado a mano',
  'people.reason.schedule': 'Por horario',
  'people.reason.paused': 'En pausa',
  'people.state.online': 'En línea',
  'people.state.offline': 'Desconectado',
  // Pausa por persona
  'people.pause': 'Pausar internet',
  'people.pauseAria': 'Pausar el internet de {name} {minutes} minutos',
  'people.resume': 'Devolver internet',
  'people.resumeAria': 'Devolver el internet a {name}',
  'people.pausedUntil': 'Sin internet hasta las {time}',
  'people.paused': 'Internet pausado',
  'people.resumed': 'Internet devuelto',
  'people.pausePartial': '{applied} de {total} dispositivos pausados. El resto se reintenta solo.',
  'people.resumePartial':
    '{applied} de {total} dispositivos reanudados. El resto se reintenta solo.',
  'people.pauseError': 'No se pudo pausar el internet',
  'people.resumeError': 'No se pudo devolver el internet',
  // Hora de dormir
  'people.bedtime': 'Hora de dormir',
  'people.bedtime.none': 'Sin hora de dormir.',
  'people.bedtime.window': 'Sin internet de {start} a {end}',
  'people.bedtime.disabled': '(desactivada)',
  'people.bedtime.appliedTo': 'Aplicada a {applied} de {total} dispositivos.',
  'people.bedtime.set': 'Poner hora de dormir',
  'people.bedtime.edit': 'Cambiar hora de dormir',
  'people.bedtime.remove': 'Quitar hora de dormir',
  'people.bedtime.title': 'Hora de dormir de {name}',
  'people.bedtime.desc':
    'Corta el internet de todos sus dispositivos en esa ventana, cada semana. Los que dé de alta más adelante la heredan.',
  'people.bedtime.days': 'Días',
  'people.bedtime.from': 'De',
  'people.bedtime.to': 'a',
  'people.bedtime.enabled': 'Activada',
  'people.bedtime.noDays': 'Elige al menos un día.',
  'people.bedtime.saved': 'Hora de dormir guardada',
  'people.bedtime.cleared': 'Hora de dormir quitada',
  'people.bedtime.saveError': 'No se pudo guardar la hora de dormir',
  'people.bedtime.clearError': 'No se pudo quitar la hora de dormir',
  'people.bedtime.noDevices':
    'Esta persona no tiene dispositivos asignados, así que la hora de dormir no cortaría nada.',
  'people.save': 'Guardar',
  'people.saving': 'Guardando…',
  'people.cancel': 'Cancelar',
} as const;

registrarFragmento(esPersonas);
