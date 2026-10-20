import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import {
  parseEstados,
  refrescarEstados,
  useDomainState,
  useDomainsIn,
  useEstadosStore,
} from '@/lib/integration-states';

const TODOS = {
  driver: 'not-configured',
  vpn: 'not-configured',
  iot: 'demo',
  cameras: 'configured',
  firewall: 'demo',
  vlan: 'not-configured',
  qos: 'demo',
  dns: 'configured',
};

describe('parseEstados', () => {
  it('acepta la respuesta del agente con los ocho dominios', () => {
    expect(parseEstados({ states: TODOS })).toEqual(TODOS);
  });

  it.each([null, undefined, 'x', 3, {}, { states: null }, { states: 'x' }])(
    'una respuesta que no es lo esperado (%j) es «no sé», no un estado inventado',
    (raw) => {
      expect(parseEstados(raw)).toBeNull();
    },
  );

  it('un estado que esta web no conoce deja ese dominio sin estado y conserva los demás', () => {
    const r = parseEstados({ states: { ...TODOS, vpn: 'degraded', extra: 'configured' } });
    expect(r?.vpn).toBeUndefined();
    expect(r?.driver).toBe('not-configured');
    expect(r).not.toHaveProperty('extra');
  });
});

describe('estado de los dominios en el store', () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    useEstadosStore.setState({ estados: null });
  });

  it('refrescarEstados pide la ruta autenticada mínima y guarda el resultado', async () => {
    apiMock.get.mockResolvedValue({ states: TODOS });
    await refrescarEstados();
    expect(apiMock.get).toHaveBeenCalledWith('/integrations/status');
    expect(useEstadosStore.getState().estados).toEqual(TODOS);
  });

  it('marca la primera lectura como intentada tanto si acierta como si falla', async () => {
    useEstadosStore.setState({ estados: null, intentado: false });
    apiMock.get.mockRejectedValueOnce(new Error('red'));
    await refrescarEstados();
    expect(useEstadosStore.getState().intentado).toBe(true);
    useEstadosStore.setState({ intentado: false });
    apiMock.get.mockResolvedValueOnce({ states: TODOS });
    await refrescarEstados();
    expect(useEstadosStore.getState().intentado).toBe(true);
  });

  it('un fallo conserva lo último que se sabía (no pasa a «sin configurar» ni a «desconocido»)', async () => {
    apiMock.get.mockResolvedValueOnce({ states: TODOS });
    await refrescarEstados();
    apiMock.get.mockRejectedValueOnce(new Error('red'));
    await refrescarEstados();
    expect(useEstadosStore.getState().estados).toEqual(TODOS);
  });

  it('una respuesta con forma rara tampoco pisa lo que había', async () => {
    apiMock.get.mockResolvedValueOnce({ states: TODOS });
    await refrescarEstados();
    apiMock.get.mockResolvedValueOnce({ otra: 'cosa' });
    await refrescarEstados();
    expect(useEstadosStore.getState().estados).toEqual(TODOS);
  });

  it('useDomainState: null mientras no se sabe, y el estado cuando llega', async () => {
    const { result } = renderHook(() => useDomainState('iot'));
    expect(result.current).toBeNull();
    apiMock.get.mockResolvedValue({ states: TODOS });
    await refrescarEstados();
    await waitFor(() => expect(result.current).toBe('demo'));
  });

  it('useDomainsIn lista los dominios de un estado, en orden estable (y vacío si no se sabe)', async () => {
    const { result } = renderHook(() => useDomainsIn('demo'));
    expect(result.current).toEqual([]);
    apiMock.get.mockResolvedValue({ states: TODOS });
    await refrescarEstados();
    await waitFor(() => expect(result.current).toEqual(['iot', 'firewall', 'qos']));
  });
});
