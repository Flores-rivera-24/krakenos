import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => {
  const get = vi.fn();
  return {
    get,
    getList: vi.fn((path: string) => get(path)),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  };
});
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { commissionMatter } from '@/lib/matter-bridge';
import { useIotDevices, useRooms, useScenes } from '@/lib/resources';
import { assignRoom, createRoom, deleteRoom, runRoomAction, updateRoom } from '@/lib/rooms';
import { createScene, deleteScene, runScene, updateScene } from '@/lib/scenes';
import { limpiarRecursos } from '@/lib/use-resource';

/**
 * Las escrituras invalidan la caché compartida de lecturas (`lib/resources.ts`).
 *
 * Se aserta el número de lecturas: tras escribir, el SIGUIENTE lector tiene que
 * volver a pedir en vez de recibir la copia de hasta 5 s. Sin la invalidación,
 * crear una escena y volver al dashboard no la mostraba.
 */

type Hook = () => unknown;

function Lector({ hook }: { hook: Hook }) {
  hook();
  return null;
}

const lecturas = (ruta: string) => apiMock.get.mock.calls.filter((c) => c[0] === ruta).length;

const HOOKS: Record<string, Hook> = {
  '/scenes': useScenes,
  '/rooms': useRooms,
  '/iot/devices': useIotDevices,
};

const ESCRITURAS: { nombre: string; ruta: string; escribir: () => Promise<unknown> }[] = [
  {
    nombre: 'crear escena',
    ruta: '/scenes',
    escribir: () => createScene({ name: 'n', actions: [] }),
  },
  { nombre: 'editar escena', ruta: '/scenes', escribir: () => updateScene('s', { name: 'n' }) },
  { nombre: 'borrar escena', ruta: '/scenes', escribir: () => deleteScene('s') },
  { nombre: 'ejecutar escena (aparatos)', ruta: '/iot/devices', escribir: () => runScene('s') },
  { nombre: 'ejecutar escena (habitaciones)', ruta: '/rooms', escribir: () => runScene('s') },
  {
    nombre: 'crear habitación',
    ruta: '/rooms',
    escribir: () => createRoom({ name: 'n', icon: 'living' } as never),
  },
  { nombre: 'editar habitación', ruta: '/rooms', escribir: () => updateRoom('r', { name: 'n' }) },
  { nombre: 'borrar habitación', ruta: '/rooms', escribir: () => deleteRoom('r') },
  {
    nombre: 'asignar habitación (habitaciones)',
    ruta: '/rooms',
    escribir: () => assignRoom({ kind: 'iot', ref: 'x', roomId: null } as never),
  },
  {
    nombre: 'asignar habitación (aparatos)',
    ruta: '/iot/devices',
    escribir: () => assignRoom({ kind: 'iot', ref: 'x', roomId: null } as never),
  },
  {
    nombre: 'acción de grupo',
    ruta: '/iot/devices',
    escribir: () => runRoomAction('r', { on: true } as never),
  },
  { nombre: 'comisionar Matter', ruta: '/iot/devices', escribir: () => commissionMatter('MT:X') },
];

describe('las escrituras invalidan la caché compartida', () => {
  beforeEach(() => {
    limpiarRecursos();
    vi.clearAllMocks();
    apiMock.get.mockResolvedValue([]);
    for (const m of [apiMock.post, apiMock.patch, apiMock.put, apiMock.del]) {
      m.mockResolvedValue({});
    }
  });

  for (const w of ESCRITURAS) {
    it(`${w.nombre}: el siguiente lector de ${w.ruta} vuelve a pedir`, async () => {
      const hook = HOOKS[w.ruta]!;
      const a = render(<Lector hook={hook} />);
      await waitFor(() => expect(lecturas(w.ruta)).toBe(1));
      a.unmount();

      // Sin escribir, dentro del TTL, el segundo lector reutiliza la caché.
      const b = render(<Lector hook={hook} />);
      b.unmount();
      expect(lecturas(w.ruta)).toBe(1);

      await w.escribir();
      render(<Lector hook={hook} />);
      await waitFor(() => expect(lecturas(w.ruta)).toBe(2));
    });
  }

  it('una escritura que falla NO invalida: el servidor no cambió', async () => {
    apiMock.post.mockRejectedValue(new Error('boom'));
    const a = render(<Lector hook={useScenes} />);
    await waitFor(() => expect(lecturas('/scenes')).toBe(1));
    a.unmount();

    await expect(createScene({ name: 'n', actions: [] })).rejects.toThrow('boom');
    render(<Lector hook={useScenes} />);
    expect(lecturas('/scenes')).toBe(1);
  });
});
