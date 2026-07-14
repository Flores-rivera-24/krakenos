import type { Wall } from '@krakenos/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const planMock = vi.hoisted(() => ({
  estimatePlanArea: vi.fn(() => 80),
  detectEnclosures: vi.fn(),
  apInCandidate: vi.fn(() => false),
}));
vi.mock('@/lib/rooms-from-plan', () => planMock);

const roomsMock = vi.hoisted(() => ({ createRoom: vi.fn() }));
vi.mock('@/lib/rooms', () => roomsMock);

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/store/toast.store', () => ({ toast: toastMock }));

import { RoomsFromPlanPanel } from '@/components/coverage/RoomsFromPlanPanel';

const wall = (): Wall => ({ id: 'w', x1: 0, y1: 0, x2: 5, y2: 0, material: 'drywall' });
const candidate = (areaM2: number) => ({ areaM2, cx: 1, cy: 1, minX: 0, minY: 0, maxX: 2, maxY: 2 });

function renderPanel(walls: Wall[] = [wall()]) {
  return render(
    <RoomsFromPlanPanel walls={walls} accessPoints={[]} widthM={10} heightM={8} canEdit />,
  );
}

describe('RoomsFromPlanPanel (US-196)', () => {
  beforeEach(() => {
    planMock.detectEnclosures.mockReset();
    roomsMock.createRoom.mockReset().mockResolvedValue({ id: 'r1' });
    toastMock.success.mockReset();
    toastMock.error.mockReset();
  });

  it('muestra la superficie del plano', () => {
    renderPanel();
    expect(screen.getByText(/Superficie del plano: 80 m²/)).toBeInTheDocument();
  });

  it('sin paredes, pide dibujarlas primero', () => {
    renderPanel([]);
    expect(screen.getByText(/Dibuja o detecta las paredes primero/)).toBeInTheDocument();
  });

  it('detecta recintos y permite crear una habitación (no automático)', async () => {
    planMock.detectEnclosures.mockReturnValue([candidate(20), candidate(12)]);
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Detectar habitaciones/ }));
    expect(await screen.findByText(/2 habitaciones detectadas/)).toBeInTheDocument();
    // No se crea nada hasta pulsar Crear.
    expect(roomsMock.createRoom).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: /Crear/ })[0]!);
    await waitFor(() => expect(roomsMock.createRoom).toHaveBeenCalledWith({ name: 'Habitación 1' }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
  });

  it('sin recintos cerrados lo dice honestamente', () => {
    planMock.detectEnclosures.mockReturnValue([]);
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Detectar habitaciones/ }));
    expect(screen.getByText(/No se detectaron recintos cerrados/)).toBeInTheDocument();
  });
});
