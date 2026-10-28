import type { ApPlacement, FloorPlan } from '@krakenos/types';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FloorPlanStage, type CoverageTool } from '@/components/coverage/FloorPlanStage';

const ap: ApPlacement = {
  id: 'ap-1',
  apId: null,
  name: 'AP salón',
  x: 5,
  y: 4,
  txPowerDbm: 20,
  bands: ['5GHz'],
  enabled: true,
};

const plan: FloorPlan = {
  id: 'plan-1',
  name: 'Casa',
  widthM: 40,
  heightM: 30,
  backgroundImage: null,
  walls: [],
  accessPoints: [ap],
  createdAt: '2026-10-27T00:00:00.000Z',
  updatedAt: '2026-10-27T00:00:00.000Z',
};

function montar(tool: CoverageTool, readOnly = false) {
  render(
    <FloorPlanStage
      plan={plan}
      walls={[]}
      accessPoints={[ap]}
      tool={tool}
      readOnly={readOnly}
      pxPerM={20}
    />,
  );
  const svg = screen.getByRole('img');
  return { svg };
}

describe('FloorPlanStage: gestos táctiles', () => {
  it('en solo lectura el svg deja desplazar en los dos ejes', () => {
    const { svg } = montar('select', true);
    expect(svg).toHaveClass('touch-pan-x', 'touch-pan-y');
    expect(svg).not.toHaveClass('touch-none');
  });

  it.each<CoverageTool>(['select', 'wall', 'ap', 'measure'])(
    'con la herramienta %s (editando) el svg bloquea el gesto',
    (tool) => {
      const { svg } = montar(tool);
      expect(svg).toHaveClass('touch-none');
      expect(svg).not.toHaveClass('touch-pan-x');
      expect(svg).not.toHaveClass('touch-pan-y');
    },
  );

  it('el cursor no cambia: «seleccionar» sigue siendo default', () => {
    const { svg } = montar('select');
    expect(svg).toHaveStyle({ cursor: 'default' });
  });

  it('tras un pointercancel el AP deja de seguir al puntero', () => {
    const onMoveAp = vi.fn();
    render(
      <FloorPlanStage
        plan={plan}
        walls={[]}
        accessPoints={[ap]}
        tool="select"
        pxPerM={20}
        onMoveAp={onMoveAp}
      />,
    );
    const svg = screen.getByRole('img');
    const asa = screen.getByRole('button', { name: /AP salón/ });
    fireEvent.pointerDown(asa, { pointerId: 1, clientX: 100, clientY: 80 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 110, clientY: 90 });
    expect(onMoveAp).toHaveBeenCalledTimes(1);
    fireEvent.pointerCancel(svg, { pointerId: 1 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 200, clientY: 200 });
    expect(onMoveAp).toHaveBeenCalledTimes(1);
  });
});
