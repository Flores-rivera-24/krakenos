import { describe, expect, it } from 'vitest';
import { ALERT_EVENTS } from '../../src/alerts/alert-config.js';
import { pushNotificationForAudit } from '../../src/modules/push/push.service.js';

/**
 * GATE (US-245): todo evento del catálogo de alertas tiene contenido de aviso.
 *
 * Por qué hace falta un gate y no basta con acordarse: `pushNotificationForAudit`
 * es la fuente de contenido de los **tres** canales —`push.service`, `mailer` y
 * `telegram` la llaman los tres *antes* de consultar `channelsFor`—, así que un
 * evento sin `case` no degrada a «solo email»: **no se envía nada, por ningún
 * canal**, mientras la UI de Ajustes → Alertas sigue enseñando sus tres
 * conmutadores. Un aviso que no avisa es indistinguible de «no ha pasado nada».
 *
 * Y no es hipotético: `energy.threshold` (US-183) y `system.tls_expiring`
 * (US-241) llevaban así desde que se añadieron. Los dos se auditaban, los dos
 * tenían su fila en el catálogo y su test verde comprobando la **auditoría**, y
 * ninguno de los dos mandó jamás un aviso. Lo cazó este gate al escribirlo.
 *
 * El alcance se **deriva del catálogo**, no de una lista escrita a mano: añadir
 * un evento a `ALERT_EVENTS` obliga a darle contenido o el gate se pone rojo
 * (mismo patrón que `egress-coverage.test.ts`, US-259).
 */
describe('cobertura de contenido del catálogo de alertas (US-245)', () => {
  // Guard de tamaño: si la importación se rompiera, la lista saldría vacía y el
  // barrido pasaría solo (US-230).
  it('el catálogo no está vacío', () => {
    expect(ALERT_EVENTS.length).toBeGreaterThan(8);
  });

  it.each(ALERT_EVENTS.map((e) => [e.event, e.label] as const))(
    '«%s» produce un aviso con título, cuerpo, destino y audiencia',
    (event) => {
      const note = pushNotificationForAudit(event, 'detalle de prueba', '10.0.0.5');
      expect(note, `el evento «${event}» está en el catálogo pero no tiene contenido de aviso: se
        configuraría en Ajustes → Alertas y no llegaría nada por push, email ni Telegram`).not.toBeNull();
      expect(note!.title.length).toBeGreaterThan(0);
      expect(note!.body.length).toBeGreaterThan(0);
      expect(note!.url.startsWith('/')).toBe(true);
      expect(['admin', 'home']).toContain(note!.audience);
    },
  );

  it('sin detalle también hay cuerpo (el aviso no puede quedar vacío)', () => {
    for (const { event } of ALERT_EVENTS) {
      const note = pushNotificationForAudit(event, null, null);
      expect(note?.body, event).toBeTruthy();
    }
  });

  it('una acción auditada que NO está en el catálogo no genera aviso', () => {
    // El complemento del gate: que no se cuele un aviso por una acción que el
    // usuario no puede desactivar (toda escritura se audita, y son ~170 rutas).
    expect(pushNotificationForAudit('iot.set_state', 'foco', null)).toBeNull();
    expect(pushNotificationForAudit('discovery.adopt', 'shelly', null)).toBeNull();
  });
});
