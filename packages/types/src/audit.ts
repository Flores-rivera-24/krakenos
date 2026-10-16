import type { Id, IsoDateTime } from './common.js';

/** Entrada del registro de auditoría. */
export interface AuditLogEntry {
  id: Id;
  /** Acción, p. ej. `auth.login`, `wifi.update`, `device.block`. */
  action: string;
  /** Usuario que la realizó, si aplica. */
  userId: string | null;
  /** Contexto adicional (texto o JSON). */
  detail: string | null;
  ip: string | null;
  createdAt: IsoDateTime;
}

/**
 * Acciones de auditoría: **catálogo cerrado** de lo que el agente registra con
 * `app.audit({ action })`. Fuente única, y vive aquí y no en el agente por la misma razón
 * que `ALERT_EVENTS`: la acción que ve el usuario («Inicio de sesión», no `auth.login`)
 * tiene que traducirse, y el catálogo de la web se declara `Record<AuditAction, …>` para
 * que **añadir una acción no compile** hasta darle su texto en los dos idiomas.
 *
 * El agente tipa `app.audit` con {@link AuditAction}, y un test recorre `src/` por AST
 * para atar las dos direcciones: ninguna acción usada fuera de la lista, ninguna acción
 * de la lista sin usar. La columna `AuditLog.action` es `string` a propósito: la tabla
 * conserva filas de versiones anteriores, que la web declara «no reconocidas».
 */
export const AUDIT_ACTIONS = [
  // Acceso: pausas y horarios de bloqueo de dispositivos y personas
  'access.pause',
  'access.resume',
  'access.schedule.create',
  'access.schedule.delete',
  'access.schedule.update',
  'access.schedule_block',
  'access.schedule_unblock',
  'device.block',
  'device.unblock',
  'device.update',
  'device.vlan',
  'people.bedtime.clear',
  'people.bedtime.set',
  'people.pause',
  'people.resume',
  'presence.mode.set',
  // Alarma, humo y monóxido de carbono
  'alarm.armed',
  'alarm.config',
  'alarm.disarm_denied',
  'alarm.disarmed',
  'alarm.sensor_fault',
  'alarm.triggered',
  'alarm.smoke',
  'alarm.co',
  // Alertas y avisos de seguridad
  'alerts.rule.update',
  'dns.new_destination',
  'inventory.unknown_device',
  // Cuentas, sesiones y acceso: login, tokens, usuarios, invitaciones, passkeys
  'apitoken.create',
  'apitoken.revoke',
  'auth.login',
  'auth.login_failed',
  'auth.login_locked',
  'auth.password.change',
  'auth.recovery_used',
  'auth.refresh_reuse',
  'auth.session.revoke',
  'auth.sessions.revoke-others',
  'setup.init',
  'setup.init_denied',
  'user.access_approved',
  'user.access_rejected',
  'user.access_requested',
  'user.create',
  'user.delete',
  'user.invite',
  'user.invite_accept',
  'user.invite_revoke',
  'user.reset_password',
  'user.update',
  'webauthn.backup-codes.regenerate',
  'webauthn.delete',
  'webauthn.register',
  // Rutinas, escenas y habitaciones
  'automation.absorb_schedules',
  'automation.create',
  'automation.delete',
  'automation.fire',
  'automation.update',
  'room.action',
  'room.assign',
  'room.create',
  'room.delete',
  'room.update',
  'scene.create',
  'scene.delete',
  'scene.run',
  'scene.update',
  // Cámaras
  'camera.add',
  'camera.motion',
  'camera.motion_config',
  'camera.recording_config',
  'camera.recording_delete',
  'camera.remove',
  'camera.stream',
  'camera.update',
  // Cobertura WiFi y red WiFi
  'coverage.floorplan.create',
  'coverage.floorplan.delete',
  'coverage.floorplan.update',
  'coverage.sample.record',
  'coverage.scan.create',
  'coverage.scan.delete',
  'wifi.guest.update',
  'wifi.network.update',
  'wifi.update',
  // Red: descubrimiento, DNS, cortafuegos, QoS, VLAN y VPN
  'discovery.adopt',
  'discovery.dismiss',
  'discovery.scan',
  'dns.block.add',
  'dns.block.remove',
  'dns.feed.update',
  'dns.history.clear',
  'firewall.rule.add',
  'firewall.rule.remove',
  'firewall.rule.update',
  'qos.rule.add',
  'qos.rule.remove',
  'qos.rule.update',
  'vlan.create',
  'vlan.delete',
  'vlan.update',
  'vpn.peer.add',
  'vpn.peer.remove',
  // Energía y tiempo exterior
  'energy.alert.create',
  'energy.alert.delete',
  'energy.alert.update',
  'energy.config.update',
  'energy.threshold',
  'weather.config',
  // Integraciones, IoT, Matter y MQTT
  'integration.remove',
  'integration.save',
  'interop.mqtt.command',
  'interop.mqtt.pause',
  'interop.mqtt.update',
  'iot.device.update',
  'iot.ids_migrated',
  'iot.matter.commission',
  'iot.tuya.add',
  'iot.tuya.remove',
  'iot.tuya.update',
  'matter.bridge.update',
  'matter.command',
  // Sistema: copias de seguridad, certificado, actualizaciones y ajustes
  'system.backup',
  'system.backup.auto',
  'system.backup.passphrase',
  'system.backup.passphrase.reveal',
  'system.regen-keys',
  'system.restore.staged',
  'system.settings.update',
  'system.support-bundle',
  'system.tls_expiring',
  'system.tls_reloaded',
  'system.update.apply',
  'system.update.cancel',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
