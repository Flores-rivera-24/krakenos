import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GuideStep, GuideStepList } from '@/components/ui/guide-step';

const writeText = vi.fn();
function setClipboard(value: { writeText: typeof writeText } | undefined) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true, writable: true });
}
beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  setClipboard({ writeText });
});
afterEach(() => setClipboard(undefined));

describe('GuideStep', () => {
  it('renderiza índice, título y cuerpo dentro de una lista ordenada', () => {
    render(
      <GuideStepList>
        <GuideStep index={1} title="Abre la app">
          Descarga la aplicación oficial.
        </GuideStep>
      </GuideStepList>,
    );
    expect(screen.getByRole('list')).toBeInTheDocument();
    const item = screen.getByRole('listitem');
    expect(item).toHaveTextContent('1');
    expect(item).toHaveTextContent('Abre la app');
    expect(item).toHaveTextContent('Descarga la aplicación oficial.');
  });

  it('muestra un bloque de comando copiable', () => {
    render(
      <GuideStepList>
        <GuideStep index={2} title="Ejecuta" command="wg show" />
      </GuideStepList>,
    );
    expect(screen.getByText('wg show')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }));
    expect(writeText).toHaveBeenCalledWith('wg show');
  });

  it('renderiza nota y advertencia como callouts', () => {
    render(
      <GuideStepList>
        <GuideStep index={3} title="Cuidado" note="Esto es una nota." warning="Esto es un aviso." />
      </GuideStepList>,
    );
    expect(screen.getAllByRole('note')).toHaveLength(2);
    expect(screen.getByText('Esto es una nota.')).toBeInTheDocument();
    expect(screen.getByText('Esto es un aviso.')).toBeInTheDocument();
  });

  it('marca el paso externo con "En tu dispositivo"', () => {
    render(
      <GuideStepList>
        <GuideStep index={4} title="Empareja el dispositivo" external />
      </GuideStepList>,
    );
    expect(screen.getByText('En tu dispositivo')).toBeInTheDocument();
  });
});
