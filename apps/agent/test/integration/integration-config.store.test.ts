import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSecretbox, generateSecretboxKey } from '../../src/config/secretbox.js';
import { IntegrationConfigStore } from '../../src/integrations/integration-config.store.js';
import { buildTestApp } from '../helpers/app.js';

describe('IntegrationConfigStore — persistencia con secretos cifrados (US-140)', () => {
  let app: FastifyInstance;
  let store: IntegrationConfigStore;

  beforeAll(async () => {
    app = await buildTestApp();
    store = new IntegrationConfigStore(app.prisma, createSecretbox(generateSecretboxKey()));
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await app.prisma.integrationConfig.deleteMany();
  });

  it('getInfo redacta secretos; getDecrypted los descifra', async () => {
    await store.save('driver', 'openwrt', {
      host: '1.2.3.4',
      username: 'root',
      password: 's3cr3t',
      sshPort: 22,
    });

    const info = await store.getInfo('driver');
    expect(info).not.toBeNull();
    expect(info!.kind).toBe('openwrt');
    expect(info!.config.host).toBe('1.2.3.4');
    expect(info!.config.password).toBeUndefined(); // el secreto NO se expone
    expect(info!.secretsSet).toContain('password');
    expect(info!.source).toBe('db');

    const dec = await store.getDecrypted('driver');
    expect(dec!.values.password).toBe('s3cr3t');
    expect(dec!.enabled).toBe(true);
  });

  it('en la DB el secreto está cifrado, nunca en claro', async () => {
    await store.save('driver', 'openwrt', { host: '1.2.3.4', password: 's3cr3t' });
    const row = await app.prisma.integrationConfig.findUnique({ where: { domain: 'driver' } });
    expect(row!.config).toContain('kbx1.'); // token de secretbox
    expect(row!.config).not.toContain('s3cr3t'); // texto plano ausente
  });

  it('un secreto omitido al re-guardar (mismo kind) se conserva', async () => {
    await store.save('driver', 'openwrt', { host: '1.2.3.4', password: 's3cr3t', sshPort: 22 });
    await store.save('driver', 'openwrt', { host: '9.9.9.9', sshPort: 22 }); // sin password
    const dec = await store.getDecrypted('driver');
    expect(dec!.values.host).toBe('9.9.9.9');
    expect(dec!.values.password).toBe('s3cr3t'); // preservado
  });

  it('cambiar de kind no arrastra secretos del anterior', async () => {
    await store.save('driver', 'openwrt', { host: '1.2.3.4', password: 's3cr3t' });
    await store.save('driver', 'asus', { host: '1.2.3.4', username: 'admin' }); // sin password
    const dec = await store.getDecrypted('driver');
    expect(dec!.kind).toBe('asus');
    expect(dec!.values.password).toBeUndefined();
  });

  it('iot: cifra/descifra secretos con clave namespaced backend.campo', async () => {
    await store.save('iot', 'hue', { 'hue.bridgeUrl': 'https://b', 'hue.appKey': 'K3Y' });
    const info = await store.getInfo('iot');
    expect(info!.config['hue.bridgeUrl']).toBe('https://b');
    expect(info!.secretsSet).toContain('hue.appKey');
    expect(info!.config['hue.appKey']).toBeUndefined();

    const dec = await store.getDecrypted('iot');
    expect(dec!.values['hue.appKey']).toBe('K3Y');
  });

  it('list y remove', async () => {
    await store.save('dns', 'pihole', { baseUrl: 'http://pi' });
    await store.save('qos', 'tc', { interface: 'eth0' });
    const all = await store.list();
    expect(all.map((i) => i.domain).sort()).toEqual(['dns', 'qos']);

    await store.remove('dns');
    expect(await store.getInfo('dns')).toBeNull();
  });

  it('desactivar (enabled=false) se persiste', async () => {
    await store.save('driver', 'openwrt', { host: '1.2.3.4', password: 'x' }, false);
    const dec = await store.getDecrypted('driver');
    expect(dec!.enabled).toBe(false);
  });
});
