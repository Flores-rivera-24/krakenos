import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSecretbox, generateSecretboxKey } from '../../src/config/secretbox.js';
import { IntegrationConfigStore } from '../../src/integrations/integration-config.store.js';
import { deriveTapoAuthHash } from '../../src/iot/tapo-auth.js';
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

  /**
   * US-259: la contraseña de Tapo es la de la **cuenta TP-Link**, no una clave del
   * aparato, así que guardarla es guardar la credencial que el usuario reutiliza en
   * otros sitios. KLAP solo necesita el hash derivado; se guarda eso.
   */
  describe('Tapo: se guarda la credencial derivada, no la contraseña (US-259)', () => {
    const EMAIL = 'duenyo@example.com';
    const PASSWORD = 'ContrasenaDeLaCuentaTPLink!';

    it('al guardar, la contraseña no llega al disco y sí el authHash', async () => {
      await store.save('iot', 'kasa', {
        'kasa.tapoEmail': EMAIL,
        'kasa.tapoPassword': PASSWORD,
      });

      const row = await app.prisma.integrationConfig.findUnique({ where: { domain: 'iot' } });
      // Ni en claro ni cifrada: la clave entera desaparece de la fila.
      expect(row!.config).not.toContain(PASSWORD);
      expect(JSON.parse(row!.config)).not.toHaveProperty('kasa.tapoPassword');

      const dec = await store.getDecrypted('iot');
      expect(dec!.values['kasa.tapoPassword']).toBeUndefined();
      expect(dec!.values['kasa.tapoAuthHash']).toBe(deriveTapoAuthHash(EMAIL, PASSWORD));
      // Y el derivado va cifrado como cualquier otro secreto (no en claro).
      expect(row!.config).not.toContain(deriveTapoAuthHash(EMAIL, PASSWORD));
    });

    it('una instalación legada que vuelve a guardar PIERDE la contraseña vieja', async () => {
      // Estado heredado: la contraseña guardada tal cual, como hasta US-259.
      await store.save('iot', 'kasa', { 'kasa.tapoPassword': PASSWORD });
      expect((await store.getDecrypted('iot'))!.values['kasa.tapoPassword']).toBe(PASSWORD);

      // El usuario hace justo lo que se le pide: volver a guardar con su email.
      await store.save('iot', 'kasa', {
        'kasa.tapoEmail': EMAIL,
        'kasa.tapoPassword': PASSWORD,
      });

      // La trampa que esto ata: `save` **preserva** los secretos omitidos, así que
      // sin el descarte explícito la contraseña vieja sobreviviría a su propia
      // sustitución y el usuario creería haberla quitado.
      const dec = await store.getDecrypted('iot');
      expect(dec!.values['kasa.tapoPassword']).toBeUndefined();
      expect(dec!.values['kasa.tapoAuthHash']).toBe(deriveTapoAuthHash(EMAIL, PASSWORD));
      const row = await app.prisma.integrationConfig.findUnique({ where: { domain: 'iot' } });
      expect(row!.config).not.toContain(PASSWORD);
    });

    it('sin email no se deriva: no se rompe una config a medio rellenar', async () => {
      await store.save('iot', 'kasa', { 'kasa.tapoPassword': PASSWORD });
      const dec = await store.getDecrypted('iot');
      expect(dec!.values['kasa.tapoPassword']).toBe(PASSWORD);
      expect(dec!.values['kasa.tapoAuthHash']).toBeUndefined();
    });

    it('no re-deriva sobre algo que ya es un hash', async () => {
      const hash = deriveTapoAuthHash(EMAIL, PASSWORD);
      await store.save('iot', 'kasa', {
        'kasa.tapoEmail': EMAIL,
        'kasa.tapoPassword': hash,
      });
      // Derivar dos veces daría un valor que ningún aparato acepta, y sin error.
      const dec = await store.getDecrypted('iot');
      expect(dec!.values['kasa.tapoAuthHash']).toBeUndefined();
      expect(dec!.values['kasa.tapoPassword']).toBe(hash);
    });

    it('otros dominios no se tocan', async () => {
      await store.save('driver', 'openwrt', { host: '1.2.3.4', password: PASSWORD });
      const dec = await store.getDecrypted('driver');
      expect(dec!.values.password).toBe(PASSWORD);
    });
  });
});
