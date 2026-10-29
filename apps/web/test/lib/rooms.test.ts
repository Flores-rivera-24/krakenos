import { describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => {
  // `getList` delega en `get` para que los mocks por ruta que ya existen
  // sigan valiendo tal cual: es el mismo GET, con la forma comprobada.
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

import { t } from '@/lib/i18n';
import { CookingPot, House } from 'lucide-react';
import { ROOM_ICONS, assignRoom, createRoom, roomIcon, runRoomAction } from '@/lib/rooms';

describe('lib/rooms (US-165)', () => {
  it('roomIcon devuelve el componente del icono, o la casa genérica si es desconocido', () => {
    expect(roomIcon('kitchen')).toBe(CookingPot);
    // Icono desconocido → casa genérica (defensivo).
    expect(roomIcon('inexistente' as never)).toBe(House);
  });

  it('el catálogo de iconos cubre todos los kinds sin iconos vacíos', () => {
    expect(ROOM_ICONS.length).toBeGreaterThanOrEqual(10);
    expect(
      ROOM_ICONS.every((r) => r.Icon !== undefined && t(`rooms.icon.${r.icon}`).length > 0),
    ).toBe(true);
  });

  it('los helpers llaman al endpoint correcto', () => {
    for (const m of [apiMock.post, apiMock.put]) m.mockResolvedValue({});
    createRoom({ name: 'Salón' });
    expect(apiMock.post).toHaveBeenCalledWith('/rooms', { name: 'Salón' });
    assignRoom({ kind: 'device', ref: 'd1', roomId: 'r1' });
    expect(apiMock.put).toHaveBeenCalledWith('/rooms/assign', {
      kind: 'device',
      ref: 'd1',
      roomId: 'r1',
    });
    runRoomAction('r1', { on: false });
    expect(apiMock.post).toHaveBeenCalledWith('/rooms/r1/action', { on: false });
  });
});
