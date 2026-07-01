import { beforeEach, describe, expect, it, vi } from 'vitest';

// El cliente de integraciones envuelve el `api` genérico; lo stubbeamos para
// verificar que llama a los endpoints correctos con el cuerpo esperado.
const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  patch: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api: apiMock }));

import {
  CATEGORY_LABELS,
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
    };
    expect(kindSchemaFor(view, 'openwrt')?.label).toBe('OpenWrt');
    expect(kindSchemaFor(view, 'inexistente')).toBeUndefined();
  });

  it('CATEGORY_LABELS agrupa firewall/vlan/qos bajo "Red avanzada"', () => {
    expect(CATEGORY_LABELS.router).toBe('Tu red y router');
    expect(CATEGORY_LABELS.lights).toBe('Luces inteligentes');
    expect(CATEGORY_LABELS.firewall).toBe('Red avanzada');
    expect(CATEGORY_LABELS.vlan).toBe('Red avanzada');
    expect(CATEGORY_LABELS.qos).toBe('Red avanzada');
  });
});
