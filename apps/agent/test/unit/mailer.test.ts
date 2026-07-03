import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Mailer,
  smtpConfigFromEnv,
  type MailMessage,
  type SendMail,
  type SmtpConfig,
} from '../../src/alerts/mailer.js';

const fakeApp = { log: { warn: () => {} } } as unknown as Pick<FastifyInstance, 'log'>;
const CONFIG: SmtpConfig = {
  host: 'smtp.test',
  port: 587,
  secure: false,
  from: 'krakenos@test',
  to: 'admin@test',
};

describe('mailer — alertas por email (US-110)', () => {
  it('envía email en un evento de alta prioridad', () => {
    const calls: MailMessage[] = [];
    const transport: SendMail = async (m) => {
      calls.push(m);
    };
    new Mailer(fakeApp, CONFIG, transport).notifyForAudit('device.block', 'aa:bb', '1.2.3.4');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.to).toBe('admin@test');
    expect(calls[0]?.from).toBe('krakenos@test');
    expect(calls[0]?.subject).toContain('Dispositivo bloqueado');
  });

  it('ignora acciones que no son de alta prioridad', () => {
    const calls: MailMessage[] = [];
    new Mailer(fakeApp, CONFIG, async (m) => {
      calls.push(m);
    }).notifyForAudit('system.settings.update');
    expect(calls).toHaveLength(0);
  });

  it('no envía si la regla de alerta desactiva el email (US-112)', () => {
    const calls: MailMessage[] = [];
    const app = {
      log: { warn: () => {} },
      alertConfig: { channelsFor: () => ({ push: true, email: false }) },
    } as unknown as Pick<FastifyInstance, 'log' | 'alertConfig'>;
    new Mailer(app, CONFIG, async (m) => {
      calls.push(m);
    }).notifyForAudit('device.block', 'aa:bb');
    expect(calls).toHaveLength(0);
  });

  it('deshabilitado si no hay config SMTP', () => {
    const calls: MailMessage[] = [];
    const mailer = new Mailer(fakeApp, null, async (m) => {
      calls.push(m);
    });
    expect(mailer.enabled).toBe(false);
    mailer.notifyForAudit('device.block', 'aa:bb');
    expect(calls).toHaveLength(0);
  });

  it('smtpConfigFromEnv devuelve null sin SMTP_HOST/ALERT_EMAIL_TO', () => {
    const prevHost = process.env.SMTP_HOST;
    const prevTo = process.env.ALERT_EMAIL_TO;
    delete process.env.SMTP_HOST;
    delete process.env.ALERT_EMAIL_TO;
    expect(smtpConfigFromEnv()).toBeNull();
    if (prevHost !== undefined) process.env.SMTP_HOST = prevHost;
    if (prevTo !== undefined) process.env.ALERT_EMAIL_TO = prevTo;
  });

  afterEach(() => {
    delete process.env.SMTP_HOST;
    delete process.env.ALERT_EMAIL_TO;
  });
});
