import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/lib/i18n';

// El cliente de integraciones envuelve el `api` genérico; lo stubbeamos para
// verificar que llama a los endpoints correctos con el cuerpo esperado.
const apiMock = vi.hoisted(() => {
  // `getList` delega en `get` para que los mocks por ruta que ya existen
  // sigan valiendo tal cual: es el mismo GET, con la forma comprobada.
  const get = vi.fn();
  return {
    get,
    getList: vi.fn((path: string) => get(path)),
    post: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
    patch: vi.fn(),
  };
});
vi.mock('@/lib/api', () => ({ api: apiMock }));

import {
  CATEGORY_LABEL_KEYS,
  deleteIntegration,
  getIntegrations,
  kindSchemaFor,
  saveIntegration,
  testIntegration,
  type DomainView,
} from '@/lib/integrations';

describe('lib/integrations', () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    apiMock.post.mockReset();
    apiMock.put.mockReset();
    apiMock.del.mockReset();
  });

  it('getIntegrations pide GET /integrations y devuelve el array de dominios', async () => {
    apiMock.get.mockResolvedValue({ domains: [{ domain: 'driver' }] });
    const views = await getIntegrations();
    expect(apiMock.get).toHaveBeenCalledWith('/integrations');
    expect(views).toEqual([{ domain: 'driver' }]);
  });

  it('getIntegrations tolera una respuesta sin `domains`', async () => {
    apiMock.get.mockResolvedValue({});
    expect(await getIntegrations()).toEqual([]);
  });

  it('saveIntegration hace PUT /integrations/:domain con { kind, config }', async () => {
    apiMock.put.mockResolvedValue({ domain: 'iot', kind: 'hue' });
    await saveIntegration('iot', { kind: 'hue', enabled: true, config: { 'hue.bridgeUrl': 'x' } });
    expect(apiMock.put).toHaveBeenCalledWith('/integrations/iot', {
      kind: 'hue',
      enabled: true,
      config: { 'hue.bridgeUrl': 'x' },
    });
  });

  it('testIntegration hace POST /integrations/:domain/test', async () => {
    apiMock.post.mockResolvedValue({ ok: true, message: 'ok' });
    await testIntegration('driver', { kind: 'openwrt', config: { host: '1.2.3.4' } });
    expect(apiMock.post).toHaveBeenCalledWith('/integrations/driver/test', {
      kind: 'openwrt',
      config: { host: '1.2.3.4' },
    });
  });

  it('deleteIntegration hace DELETE /integrations/:domain', async () => {
    apiMock.del.mockResolvedValue(undefined);
    await deleteIntegration('dns');
    expect(apiMock.del).toHaveBeenCalledWith('/integrations/dns');
  });

  it('kindSchemaFor encuentra el esquema por kind (o undefined)', () => {
    const view: DomainView = {
      domain: 'driver',
      kinds: [
        { domain: 'driver', kind: 'mock', label: 'Demo', fields: [] },
        { domain: 'driver', kind: 'openwrt', label: 'OpenWrt', fields: [] },
      ],
      current: null,
      effectiveKind: 'mock',
      source: 'env',
      state: 'demo',
    };
    expect(kindSchemaFor(view, 'openwrt')?.label).toBe('OpenWrt');
    expect(kindSchemaFor(view, 'inexistente')).toBeUndefined();
  });

  it('CATEGORY_LABEL_KEYS agrupa firewall/vlan/qos bajo "Red avanzada"', () => {
    expect(t(CATEGORY_LABEL_KEYS.router)).toBe('Tu red y router');
    expect(t(CATEGORY_LABEL_KEYS.lights)).toBe('Luces inteligentes');
    expect(t(CATEGORY_LABEL_KEYS.firewall)).toBe('Red avanzada');
    expect(t(CATEGORY_LABEL_KEYS.vlan)).toBe('Red avanzada');
    expect(t(CATEGORY_LABEL_KEYS.qos)).toBe('Red avanzada');
    // Son la MISMA clave: es lo que las junta en una sola sección del hub.
    expect(CATEGORY_LABEL_KEYS.firewall).toBe(CATEGORY_LABEL_KEYS.vlan);
    expect(CATEGORY_LABEL_KEYS.vlan).toBe(CATEGORY_LABEL_KEYS.qos);
  });

  describe('conectar o desconectar relee el estado de los dominios', () => {
    const lecturasDeEstado = () =>
      apiMock.get.mock.calls.filter(([p]) => p === '/integrations/status');

    beforeEach(() => {
      apiMock.get.mockResolvedValue({ states: {} });
    });

    it('saveIntegration, tras el ÉXITO', async () => {
      apiMock.put.mockResolvedValue({ domain: 'dns', kind: 'pihole' });
      await saveIntegration('dns', { kind: 'pihole', config: {} });
      await vi.waitFor(() => expect(lecturasDeEstado()).toHaveLength(1));
    });

    it('saveIntegration NO relee si el guardado falló', async () => {
      apiMock.put.mockRejectedValue(new Error('boom'));
      await expect(saveIntegration('dns', { kind: 'pihole', config: {} })).rejects.toThrow('boom');
      expect(lecturasDeEstado()).toHaveLength(0);
    });

    it('deleteIntegration, tras el ÉXITO', async () => {
      apiMock.del.mockResolvedValue(undefined);
      await deleteIntegration('dns');
      await vi.waitFor(() => expect(lecturasDeEstado()).toHaveLength(1));
    });

    it('deleteIntegration NO relee si el borrado falló', async () => {
      apiMock.del.mockRejectedValue(new Error('boom'));
      await expect(deleteIntegration('dns')).rejects.toThrow('boom');
      expect(lecturasDeEstado()).toHaveLength(0);
    });

    it('adoptar una sugerencia (escribe la config de un dominio) también relee', async () => {
      apiMock.post.mockResolvedValue({ suggestions: [] });
      const { adoptSuggestion } = await import('@/lib/discovery');
      await adoptSuggestion('hue-1');
      await vi.waitFor(() => expect(lecturasDeEstado()).toHaveLength(1));
    });
  });
});
