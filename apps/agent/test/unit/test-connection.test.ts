import type { IntegrationDomain } from '@krakenos/types';
import { describe, expect, it } from 'vitest';
import type { DomainRecord } from '../../src/integrations/factory-config.js';
import { testConnection } from '../../src/integrations/test-connection.js';

/**
 * US-142/US-219: la prueba de conexión construye un manager **transitorio** con la
 * config propuesta y hace una lectura ligera. Con `kind: 'mock'` siempre pasa; un
 * dominio desconocido se traduce a un fallo legible (no lanza).
 */
const mockRecord: DomainRecord = { kind: 'mock', values: {} };
const DOMAINS: IntegrationDomain[] = [
  'driver',
  'vpn',
  'iot',
  'cameras',
  'firewall',
  'vlan',
  'qos',
  'dns',
];

describe('testConnection (US-142)', () => {
  it.each(DOMAINS)('un manager mock del dominio %s responde ok', async (domain) => {
    const res = await testConnection(domain, mockRecord);
    expect(res.ok).toBe(true);
    expect(res.message).toBeTruthy();
  });

  it('un dominio desconocido se traduce a un fallo legible, sin lanzar', async () => {
    const res = await testConnection('desconocido' as IntegrationDomain, mockRecord);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/No se pudo conectar/);
  });
});
