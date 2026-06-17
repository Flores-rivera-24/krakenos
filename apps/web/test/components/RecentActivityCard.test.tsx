import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RecentActivityCard } from '@/components/dashboard/RecentActivityCard';
import type { ActivityEvent } from '@/store/inventory.store';

const at = '2026-06-17T12:00:00.000Z';

describe('RecentActivityCard', () => {
  it('muestra el placeholder sin eventos', () => {
    render(<RecentActivityCard events={[]} />);
    expect(screen.getByText(/Sin actividad todavía/)).toBeInTheDocument();
  });

  it('lista los eventos con su etiqueta de tipo', () => {
    const events: ActivityEvent[] = [
      { id: '1', kind: 'updated', label: 'Router', at },
      { id: '2', kind: 'removed', label: 'Tele', at },
    ];
    render(<RecentActivityCard events={events} />);
    expect(screen.getByText('Router')).toBeInTheDocument();
    expect(screen.getByText('actualizado')).toBeInTheDocument();
    expect(screen.getByText('Tele')).toBeInTheDocument();
    expect(screen.getByText('eliminado')).toBeInTheDocument();
  });

  it('limita la lista a 6 entradas visibles', () => {
    const events: ActivityEvent[] = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      kind: 'updated' as const,
      label: `Dispositivo ${i}`,
      at,
    }));
    render(<RecentActivityCard events={events} />);
    expect(screen.getAllByText(/actualizado/)).toHaveLength(6);
  });
});
