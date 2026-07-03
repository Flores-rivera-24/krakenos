import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const downloadReport = vi.hoisted(() => vi.fn());
vi.mock('@/lib/reports', () => ({ downloadReport }));

import { ReportsCard } from '@/components/settings/ReportsCard';
import { Toaster } from '@/components/ui/toast';
import { useToastStore } from '@/store/toast.store';

describe('ReportsCard — exportación CSV (US-109)', () => {
  beforeEach(() => {
    downloadReport.mockReset().mockResolvedValue(undefined);
    useToastStore.setState({ toasts: [] });
  });

  it('descarga el informe correcto al pulsar', async () => {
    const user = userEvent.setup();
    render(<ReportsCard />);
    await user.click(screen.getByRole('button', { name: 'Dispositivos' }));
    await waitFor(() =>
      expect(downloadReport).toHaveBeenCalledWith('/reports/devices.csv', 'krakenos-dispositivos.csv'),
    );
  });

  it('avisa por toast si la descarga falla', async () => {
    downloadReport.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    render(
      <>
        <ReportsCard />
        <Toaster />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Auditoría' }));
    expect(await screen.findByText(/No se pudo generar el informe/)).toBeInTheDocument();
  });
});
