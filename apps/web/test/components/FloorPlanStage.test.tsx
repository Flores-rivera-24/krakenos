import type { ApPlacement, FloorPlan } from '@krakenos/types';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FloorPlanStage, type CoverageTool } from '@/components/coverage/FloorPlanStage';
import { t } from '@/lib/i18n';
import '@/lib/i18n/catalog/fragments/cobertura';

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
  return screen.getByRole('group');
}

describe('FloorPlanStage: gestos táctiles', () => {
  it('en solo lectura el svg deja desplazar en los dos ejes', () => {
    const svg = montar('select', true);
    expect(svg).toHaveClass('touch-pan-x', 'touch-pan-y');
    expect(svg).not.toHaveClass('touch-none');
  });

  it.each<CoverageTool>(['select', 'wall', 'ap', 'measure'])(
    'con la herramienta %s (editando) el svg bloquea el gesto',
    (tool) => {
      const svg = montar(tool);
      expect(svg).toHaveClass('touch-none');
      expect(svg).not.toHaveClass('touch-pan-x');
      expect(svg).not.toHaveClass('touch-pan-y');
    },
  );

  it('el cursor no cambia: «seleccionar» sigue siendo default', () => {
    const svg = montar('select');
    expect(svg).toHaveStyle({ cursor: 'default' });
  });

  // jsdom no implementa la captura de puntero en el svg: se dobla para poder observarla.
  function conCaptura(svg: Element) {
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    Object.defineProperty(svg, 'setPointerCapture', { value: setPointerCapture });
    Object.defineProperty(svg, 'releasePointerCapture', { value: releasePointerCapture });
    return { setPointerCapture, releasePointerCapture };
  }

  it('tras un pointercancel el AP deja de seguir al puntero y se libera la captura', () => {
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
    const svg = screen.getByRole('group');
    const { setPointerCapture, releasePointerCapture } = conCaptura(svg);
    const asa = screen.getByRole('button', { name: /AP salón/ });
    fireEvent.pointerDown(asa, { pointerId: 1, clientX: 100, clientY: 80 });
    expect(setPointerCapture).toHaveBeenCalledWith(1);
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 110, clientY: 90 });
    expect(onMoveAp).toHaveBeenCalledTimes(1);
    expect(releasePointerCapture).not.toHaveBeenCalled();
    fireEvent.pointerCancel(svg, { pointerId: 1 });
    expect(releasePointerCapture).toHaveBeenCalledWith(1);
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 200, clientY: 200 });
    expect(onMoveAp).toHaveBeenCalledTimes(1);
  });

  it('un trazo de pared cancelado no guarda la pared; uno terminado sí', () => {
    const onAddWall = vi.fn();
    render(
      <FloorPlanStage
        plan={plan}
        walls={[]}
        accessPoints={[ap]}
        tool="wall"
        pxPerM={20}
        onAddWall={onAddWall}
      />,
    );
    const svg = screen.getByRole('group');
    const { releasePointerCapture } = conCaptura(svg);
    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 120, clientY: 20 });
    fireEvent.pointerCancel(svg, { pointerId: 1 });
    fireEvent.pointerUp(svg, { pointerId: 1 });
    expect(onAddWall).not.toHaveBeenCalled();
    expect(releasePointerCapture).toHaveBeenCalledWith(1);

    // Control positivo: el mismo trazo, terminado, sí guarda.
    fireEvent.pointerDown(svg, { pointerId: 2, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(svg, { pointerId: 2, clientX: 120, clientY: 20 });
    fireEvent.pointerUp(svg, { pointerId: 2 });
    expect(onAddWall).toHaveBeenCalledTimes(1);
  });
});

describe('FloorPlanStage: teclado y lector', () => {
  const ariaPlano = 'Plano Casa: 40×30 m con 1 punto de acceso';

  function editar(apOver: Partial<ApPlacement> = {}) {
    const onMoveAp = vi.fn();
    const a = { ...ap, ...apOver };
    render(
      <FloorPlanStage
        plan={plan}
        walls={[]}
        accessPoints={[a]}
        tool="select"
        pxPerM={20}
        onMoveAp={onMoveAp}
      />,
    );
    return { onMoveAp, boton: screen.getByRole('button', { name: /AP salón/ }) };
  }

  it('el plano es un grupo con nombre, no una imagen', () => {
    editar();
    expect(screen.getByRole('group', { name: ariaPlano })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: ariaPlano })).toBeNull();
  });

  it('en edición, ArrowRight mueve el AP 0,1 m', () => {
    const { onMoveAp, boton } = editar();
    fireEvent.keyDown(boton, { key: 'ArrowRight' });
    expect(onMoveAp).toHaveBeenCalledTimes(1);
    const [id, x, y] = onMoveAp.mock.calls[0] as [string, number, number];
    expect(id).toBe('ap-1');
    expect(x).toBeCloseTo(5.1, 6);
    expect(y).toBeCloseTo(4, 6);
  });

  it('cada flecha mueve en su sentido', () => {
    const { onMoveAp, boton } = editar();
    fireEvent.keyDown(boton, { key: 'ArrowLeft' });
    fireEvent.keyDown(boton, { key: 'ArrowUp' });
    fireEvent.keyDown(boton, { key: 'ArrowDown' });
    const [l, u, d] = onMoveAp.mock.calls as [string, number, number][];
    expect([l![1], l![2]]).toEqual([expect.closeTo(4.9, 6), 4]);
    expect([u![1], u![2]]).toEqual([5, expect.closeTo(3.9, 6)]);
    expect([d![1], d![2]]).toEqual([5, expect.closeTo(4.1, 6)]);
  });

  it('con Mayús, 1 m', () => {
    const { onMoveAp, boton } = editar();
    fireEvent.keyDown(boton, { key: 'ArrowDown', shiftKey: true });
    expect(onMoveAp).toHaveBeenCalledWith('ap-1', 5, 5);
  });

  it('en el borde no se sale', () => {
    const { onMoveAp, boton } = editar({ x: 40 });
    fireEvent.keyDown(boton, { key: 'ArrowRight' });
    for (const [, x] of onMoveAp.mock.calls as [string, number][])
      expect(x).toBeLessThanOrEqual(40);
  });

  it('otras teclas no mueven ni se interceptan', () => {
    const { onMoveAp, boton } = editar();
    expect(fireEvent.keyDown(boton, { key: 'Tab' })).toBe(true);
    expect(onMoveAp).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(boton, { key: 'ArrowRight' })).toBe(false);
  });

  it('en lectura las flechas no llaman a onMoveAp y el AP no es un botón', () => {
    const onMoveAp = vi.fn();
    render(
      <FloorPlanStage
        plan={plan}
        walls={[]}
        accessPoints={[ap]}
        tool="select"
        readOnly
        pxPerM={20}
        onMoveAp={onMoveAp}
      />,
    );
    expect(screen.queryByRole('button', { name: /AP salón/ })).toBeNull();
    const img = screen.getByRole('img', { name: /AP salón/ });
    fireEvent.keyDown(img, { key: 'ArrowRight' });
    expect(onMoveAp).not.toHaveBeenCalled();
    expect(img).not.toHaveAttribute('tabindex');
  });

  it('el AP en edición describe cómo moverlo', () => {
    const { boton } = editar();
    expect(boton).toHaveAccessibleDescription(t('coverage.ap.moveHint'));
    expect(t('coverage.ap.moveHint')).toBe('Usa las flechas para moverlo 0,1 m; con Mayús, 1 m.');
  });
});
