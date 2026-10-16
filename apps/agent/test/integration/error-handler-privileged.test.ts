import { Writable } from 'node:stream';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerErrorHandler } from '../../src/plugins/error-handler.js';
import { PrivilegedCommandError } from '../../src/privileged/runner.js';

/**
 * `PrivilegedCommandError` llegaba sin capturar desde WireGuard/iptables/tc y salía como un
 * 500 «Error interno del servidor.»: el usuario no podía distinguir «el sistema rechazó el
 * comando» de un bug del agente. Se mapea en el manejador global (punto único).
 */
describe('manejador de errores: PrivilegedCommandError', () => {
  it('503 PRIVILEGED_COMMAND_FAILED sin el stderr; el detalle va al log del servidor', async () => {
    const lineas: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lineas.push(chunk.toString());
        cb();
      },
    });
    const app = Fastify({ logger: { level: 'error', stream } });
    registerErrorHandler(app);
    app.get('/boom', async () => {
      throw new PrivilegedCommandError(['iptables', '-F', 'KRAKENOS'], {
        stdout: '',
        stderr: 'iptables: Permission denied (you must be root) en /sbin/xtables',
        code: 4,
      });
    });
    await app.ready();
    try {
      const res = await app.inject({ method: 'GET', url: '/boom' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({
        statusCode: 503,
        code: 'PRIVILEGED_COMMAND_FAILED',
        error: 'Service Unavailable',
        message:
          'No se pudo aplicar el cambio en el sistema. El detalle está en el registro del servidor.',
      });
      expect(res.body).not.toContain('Permission denied');
      expect(res.body).not.toContain('xtables');
      expect(res.body).not.toContain('iptables');

      // El operador sí lo ve: sin esto el 503 no se podría diagnosticar.
      const log = lineas.join('');
      expect(log).toContain('Permission denied');
      expect(log).toContain('KRAKENOS');
    } finally {
      await app.close();
    }
  });
});
