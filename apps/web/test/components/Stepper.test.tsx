import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { configureAxe, toHaveNoViolations } from 'jest-axe';
import { describe, expect, it, vi } from 'vitest';
import { Stepper, type StepperStep } from '@/components/ui/stepper';

expect.extend(toHaveNoViolations);
const axe = configureAxe({
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
});

const STEPS: StepperStep[] = [
  { id: 's1', title: 'Conecta', content: <p>Contenido 1</p> },
  { id: 's2', title: 'Verifica', content: <p>Contenido 2</p> },
  { id: 's3', title: 'Listo', content: <p>Contenido 3</p> },
];

function renderStepper(props: Partial<Parameters<typeof Stepper>[0]> = {}) {
  const onStepChange = vi.fn();
  const onComplete = vi.fn();
  render(
    <Stepper
      steps={STEPS}
      current={0}
      onStepChange={onStepChange}
      onComplete={onComplete}
      {...props}
    />,
  );
  return { onStepChange, onComplete };
}

describe('Stepper', () => {
  it('muestra el progreso y solo el contenido del paso activo', () => {
    renderStepper({ current: 0 });
    expect(screen.getByText('Paso 1 de 3')).toBeInTheDocument();
    expect(screen.getByText('Contenido 1')).toBeInTheDocument();
    expect(screen.queryByText('Contenido 2')).not.toBeInTheDocument();
    // Anuncio para lector de pantalla.
    expect(screen.getByRole('status')).toHaveTextContent('Paso 1 de 3: Conecta');
  });

  it('marca los segmentos de progreso como completado/actual/pendiente', () => {
    renderStepper({ current: 1 });
    const segments = document.querySelectorAll('li[data-state]');
    expect(segments).toHaveLength(3);
    expect(segments[0]).toHaveAttribute('data-state', 'completed');
    expect(segments[1]).toHaveAttribute('data-state', 'current');
    expect(segments[2]).toHaveAttribute('data-state', 'upcoming');
  });

  it('deshabilita "Atrás" en el primer paso', () => {
    renderStepper({ current: 0 });
    expect(screen.getByRole('button', { name: 'Atrás' })).toBeDisabled();
  });

  it('"Siguiente" pide avanzar al siguiente índice', async () => {
    const user = userEvent.setup();
    const { onStepChange, onComplete } = renderStepper({ current: 0 });
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(onStepChange).toHaveBeenCalledWith(1);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('"Atrás" pide retroceder', async () => {
    const user = userEvent.setup();
    const { onStepChange } = renderStepper({ current: 1 });
    await user.click(screen.getByRole('button', { name: 'Atrás' }));
    expect(onStepChange).toHaveBeenCalledWith(0);
  });

  it('deshabilita "Siguiente" cuando el paso no permite avanzar', () => {
    const gated: StepperStep[] = [
      { id: 'g', title: 'G', content: 'c', canAdvance: false },
      { id: 'h', title: 'H', content: 'c2' },
    ];
    render(<Stepper steps={gated} current={0} onStepChange={vi.fn()} onComplete={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  });

  it('en el último paso muestra "Finalizar" y llama onComplete', async () => {
    const user = userEvent.setup();
    const { onComplete, onStepChange } = renderStepper({ current: 2 });
    await user.click(screen.getByRole('button', { name: 'Finalizar' }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onStepChange).not.toHaveBeenCalled();
  });

  it('busy: muestra spinner, marca aria-busy y bloquea la navegación', () => {
    renderStepper({ current: 1, busy: true });
    const next = screen.getByRole('button', { name: 'Siguiente' });
    expect(next).toBeDisabled();
    expect(next).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Atrás' })).toBeDisabled();
  });

  it('muestra "Omitir" en pasos saltables y avanza sin validar', async () => {
    const user = userEvent.setup();
    const steps: StepperStep[] = [
      { id: 'a', title: 'A', content: 'c', canAdvance: false, skippable: true },
      { id: 'b', title: 'B', content: 'c2' },
    ];
    const onStepChange = vi.fn();
    render(<Stepper steps={steps} current={0} onStepChange={onStepChange} onComplete={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Omitir' }));
    expect(onStepChange).toHaveBeenCalledWith(1);
  });

  it('"Omitir" en el último paso completa el flujo', async () => {
    const user = userEvent.setup();
    const steps: StepperStep[] = [
      { id: 'a', title: 'A', content: 'c' },
      { id: 'b', title: 'B', content: 'c2', skippable: true },
    ];
    const onComplete = vi.fn();
    render(<Stepper steps={steps} current={1} onStepChange={vi.fn()} onComplete={onComplete} />);
    await user.click(screen.getByRole('button', { name: 'Omitir' }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('renderiza la descripción y respeta etiquetas personalizadas', () => {
    const steps: StepperStep[] = [
      { id: 'a', title: 'A', description: 'Explica A', content: 'c' },
      { id: 'b', title: 'B', content: 'c2' },
    ];
    render(
      <Stepper
        steps={steps}
        current={0}
        onStepChange={vi.fn()}
        onComplete={vi.fn()}
        nextLabel="Continuar"
        backLabel="Volver"
      />,
    );
    expect(screen.getByText('Explica A')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Volver' })).toBeInTheDocument();
  });

  it('no renderiza nada sin pasos', () => {
    const { container } = render(
      <Stepper steps={[]} current={0} onStepChange={vi.fn()} onComplete={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('acota un índice fuera de rango al último paso', async () => {
    const user = userEvent.setup();
    const { onComplete } = renderStepper({ current: 99 });
    expect(screen.getByText('Paso 3 de 3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Finalizar' }));
    expect(onComplete).toHaveBeenCalled();
  });

  it('acota un índice negativo al primer paso', () => {
    renderStepper({ current: -5 });
    expect(screen.getByText('Paso 1 de 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Atrás' })).toBeDisabled();
  });

  it('no tiene violaciones axe', async () => {
    const { container } = render(
      <Stepper steps={STEPS} current={1} onStepChange={vi.fn()} onComplete={vi.fn()} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
