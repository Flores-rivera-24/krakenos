import { describe, expect, it } from 'vitest';
import { EgressBlockedError } from '../../src/net/egress.js';
import { assertPushEndpointAllowed } from '../../src/push/endpoint.js';

/**
 * Guarda del endpoint de suscripción Web Push (AUD3-01, US-227).
 *
 * El `endpoint` lo elige el cliente y el agente le hará un POST: era la única
 * salida del agente que NO pasaba por la política de egress, con la particularidad
 * de que aquí la política correcta es la **estricta** (un push service jamás vive
 * en la LAN), no la LAN-friendly del resto de la app.
 */
describe('assertPushEndpointAllowed', () => {
  const rejects = async (endpoint: string) => {
    await expect(assertPushEndpointAllowed(endpoint)).rejects.toBeInstanceOf(EgressBlockedError);
  };

  it('bloquea la metadata de nube (IMDS)', async () => {
    await rejects('https://169.254.169.254/latest/meta-data');
    await rejects('https://[fd00:ec2::254]/latest/meta-data');
  });

  it('bloquea link-local, loopback y rangos privados (política estricta)', async () => {
    await rejects('https://169.254.10.10/x');
    await rejects('https://127.0.0.1/x');
    await rejects('https://[::1]/x');
    await rejects('https://10.0.0.5/x');
    await rejects('https://192.168.1.1/x');
    await rejects('https://172.16.0.1/x');
  });

  it('bloquea el bypass de IPv4 mapeada en IPv6', async () => {
    await rejects('https://[::ffff:169.254.169.254]/x');
    await rejects('https://[::ffff:127.0.0.1]/x');
  });

  it('exige https (no http, no otros esquemas)', async () => {
    await rejects('http://push.example/abc');
    await rejects('file:///etc/passwd');
    await rejects('ftp://push.example/abc');
  });

  it('rechaza credenciales embebidas y URLs inválidas', async () => {
    await rejects('https://user:pass@push.example/abc');
    await rejects('no-es-una-url');
    await rejects('');
  });

  it('acepta un endpoint público normal', async () => {
    // `push.example` no resuelve (TLD reservado): un nombre sin resolución no es un
    // objetivo de SSRF —no hay a dónde ir— y el envío fallaría solo. Lo que se
    // bloquea es un nombre que SÍ resuelve a un destino interno.
    const url = await assertPushEndpointAllowed('https://push.example/abc');
    expect(url.hostname).toBe('push.example');
  });
});
