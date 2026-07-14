import type { ProposedWall } from '@/lib/wall-propose';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WallDetectPanel } from '@/components/coverage/WallDetectPanel';

const base = {
  hasImage: true,
  detecting: false,
  proposed: null as ProposedWall[] | null,
  material: 'drywall' as const,
  onMaterialChange: vi.fn(),
  onDetect: vi.fn(),
  onAccept: vi.fn(),
  onDiscard: vi.fn(),
  canEdit: true,
};

const wall = (): ProposedWall => ({ x1: 0, y1: 0, x2: 5, y2: 0, confidence: 0.9 });

describe('WallDetectPanel (US-195)', () => {
  it('sin imagen de fondo, invita a subir un plano', () => {
    render(<WallDetectPanel {...base} hasImage={false} />);
    expect(screen.getByText(/Sube un plano de fondo/)).toBeInTheDocument();
  });

  it('con imagen y sin propuestas, ofrece detectar', () => {
    const onDetect = vi.fn();
    render(<WallDetectPanel {...base} onDetect={onDetect} />);
    fireEvent.click(screen.getByRole('button', { name: /Detectar paredes/ }));
    expect(onDetect).toHaveBeenCalled();
  });

  it('muestra el conteo de propuestas y permite aceptarlas', () => {
    const onAccept = vi.fn();
    render(<WallDetectPanel {...base} proposed={[wall(), wall()]} onAccept={onAccept} />);
    expect(screen.getByText(/2 paredes propuestas/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Aceptar todas/ }));
    expect(onAccept).toHaveBeenCalled();
  });

  it('sin paredes detectadas, lo dice honestamente y ofrece descartar', () => {
    const onDiscard = vi.fn();
    render(<WallDetectPanel {...base} proposed={[]} onDiscard={onDiscard} />);
    expect(screen.getByText(/No se detectaron paredes/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Descartar/ }));
    expect(onDiscard).toHaveBeenCalled();
  });

  it('un no-admin no ve el panel', () => {
    const { container } = render(<WallDetectPanel {...base} canEdit={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
