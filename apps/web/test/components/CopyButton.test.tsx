import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CopyButton } from '@/components/ui/copy-button';

const writeText = vi.fn();

/**
 * jsdom trae un `navigator.clipboard` propio y `userEvent.setup()` instala otro;
 * por eso aquí usamos `fireEvent` e inyectamos nuestro propio mock por test.
 */
function setClipboard(value: { writeText: typeof writeText } | undefined) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true, writable: true });
}

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  setClipboard({ writeText });
});
afterEach(() => setClipboard(undefined));

describe('CopyButton', () => {
  it('copia el valor y muestra el feedback "¡Copiado!"', async () => {
    render(<CopyButton value="clave-secreta" />);
    const btn = screen.getByRole('button', { name: 'Copiar' });

    fireEvent.click(btn);
    expect(await screen.findByRole('button', { name: '¡Copiado!' })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith('clave-secreta');
    expect(btn).toHaveAttribute('data-copied', 'true');
    expect(btn).toHaveClass('text-success');
  });

  it('invoca onCopied con el valor copiado', async () => {
    const onCopied = vi.fn();
    render(<CopyButton value="v" onCopied={onCopied} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }));
    await waitFor(() => expect(onCopied).toHaveBeenCalledWith('v'));
  });

  it('revierte el feedback tras feedbackMs', async () => {
    render(<CopyButton value="v" feedbackMs={50} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }));
    await screen.findByRole('button', { name: '¡Copiado!' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Copiar' })).toBeInTheDocument(),
    );
  });

  it('muestra el texto junto al icono con showLabel', async () => {
    render(<CopyButton value="v" showLabel />);
    expect(screen.getByText('Copiar')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }));
    expect(await screen.findByText('¡Copiado!')).toBeInTheDocument();
  });

  it('acepta etiquetas personalizadas', async () => {
    render(<CopyButton value="v" label="Copiar token" copiedLabel="Listo" />);
    const btn = screen.getByRole('button', { name: 'Copiar token' });
    fireEvent.click(btn);
    expect(await screen.findByRole('button', { name: 'Listo' })).toBeInTheDocument();
  });

  it('degrada sin romper si el portapapeles no está disponible', async () => {
    setClipboard(undefined);
    render(<CopyButton value="v" />);
    const btn = screen.getByRole('button', { name: 'Copiar' });
    fireEvent.click(btn);
    await Promise.resolve();
    expect(writeText).not.toHaveBeenCalled();
    expect(btn).toHaveAttribute('data-copied', 'false');
  });

  it('no muestra "copiado" si la escritura es rechazada', async () => {
    writeText.mockRejectedValue(new Error('permiso denegado'));
    render(<CopyButton value="v" />);
    const btn = screen.getByRole('button', { name: 'Copiar' });
    fireEvent.click(btn);
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(btn).toHaveAttribute('data-copied', 'false');
  });
});
