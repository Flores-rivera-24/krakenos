import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `errors.ts` importa ApiRequestError de '@/lib/api'; lo stubbeamos para que
// `describeError` clasifique los rechazos como fallo de red.
vi.mock('@/lib/api', () => ({ ApiRequestError: class extends Error {} }));

import { OptimisticSwitch } from '@/components/ui/optimistic-switch';
import { Toaster } from '@/components/ui/toast';
import { useToastStore } from '@/store/toast.store';

describe('OptimisticSwitch', () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }));

  it('en éxito conserva el nuevo estado, sin revertir ni avisar', async () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(
      <>
        <OptimisticSwitch checked={false} onToggle={onToggle} aria-label="luz" />
        <Toaster />
      </>,
    );
    const sw = screen.getByRole('switch');

    fireEvent.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'));
    expect(onToggle).toHaveBeenCalledWith(true);
    expect(useToastStore.getState().toasts).toHaveLength(0); // sin toast de error
  });

  it('adopta la verdad del servidor cuando cambia la prop', () => {
    const { rerender } = render(
      <OptimisticSwitch checked={false} onToggle={vi.fn()} aria-label="luz" />,
    );
    const sw = screen.getByRole('switch');
    expect(sw).toHaveAttribute('aria-checked', 'false');

    // p. ej. un `iot:device-updated` del socket: la verdad manda.
    rerender(<OptimisticSwitch checked={true} onToggle={vi.fn()} aria-label="luz" />);
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });
});
