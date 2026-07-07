import { describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { ROOM_ICONS, assignRoom, createRoom, roomGlyph, runRoomAction } from '@/lib/rooms';

describe('lib/rooms (US-165)', () => {
  it('roomGlyph devuelve el glifo del icono, o la casa genérica si es desconocido', () => {
    expect(roomGlyph('kitchen')).toBe('🍳');
    // Icono desconocido → casa genérica (defensivo).
    expect(roomGlyph('inexistente' as never)).toBe('🏠');
  });

  it('el catálogo de iconos cubre todos los kinds sin glifos vacíos', () => {
    expect(ROOM_ICONS.length).toBeGreaterThanOrEqual(10);
    expect(ROOM_ICONS.every((r) => r.glyph.length > 0 && r.label.length > 0)).toBe(true);
  });

  it('los helpers llaman al endpoint correcto', () => {
    createRoom({ name: 'Salón' });
    expect(apiMock.post).toHaveBeenCalledWith('/rooms', { name: 'Salón' });
    assignRoom({ kind: 'device', ref: 'd1', roomId: 'r1' });
    expect(apiMock.put).toHaveBeenCalledWith('/rooms/assign', { kind: 'device', ref: 'd1', roomId: 'r1' });
    runRoomAction('r1', { on: false });
    expect(apiMock.post).toHaveBeenCalledWith('/rooms/r1/action', { on: false });
  });
});
