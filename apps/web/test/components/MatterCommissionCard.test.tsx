import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ post: vi.fn() }));
const ApiRequestError = vi.hoisted(
  () =>
    class ApiRequestError extends Error {
      status: number;
      body: { code?: string; message: string };
      constructor(status: number, body: { code?: string; message: string }) {
        super(body.message);
        this.status = status;
        this.body = body;
      }
    },
);
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError }));

import { MatterCommissionCard } from '@/components/connect/MatterCommissionCard';

describe('MatterCommissionCard (US-172)', () => {
  beforeEach(() => {
    apiMock.post.mockReset();
  });

  it('comisiona y muestra el éxito con el nombre del dispositivo', async () => {
    apiMock.post.mockResolvedValue({ deviceId: 'matter:9', name: 'Bombilla' });
    render(<MatterCommissionCard />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Añadir un dispositivo Matter'), 'MT:ABC123');
    await user.click(screen.getByRole('button', { name: 'Añadir' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/Bombilla.*añadido/);
    expect(apiMock.post).toHaveBeenCalledWith('/iot/matter/commission', { code: 'MT:ABC123' });
  });

  it('traduce el código de error a un mensaje amable (código inválido)', async () => {
    apiMock.post.mockRejectedValue(new ApiRequestError(400, { code: 'invalid-code', message: 'x' }));
    render(<MatterCommissionCard />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Añadir un dispositivo Matter'), 'MT:BAD');
    await user.click(screen.getByRole('button', { name: 'Añadir' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/no es válido/);
  });

  it('explica el caso Thread sin border router', async () => {
    apiMock.post.mockRejectedValue(
      new ApiRequestError(400, { code: 'thread-no-border', message: 'x' }),
    );
    render(<MatterCommissionCard />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Añadir un dispositivo Matter'), 'MT:THREAD');
    await user.click(screen.getByRole('button', { name: 'Añadir' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/border router/);
  });

  it('explica que no hay integración Matter activa (409)', async () => {
    apiMock.post.mockRejectedValue(
      new ApiRequestError(409, { code: 'MATTER_UNAVAILABLE', message: 'x' }),
    );
    render(<MatterCommissionCard />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Añadir un dispositivo Matter'), 'MT:X1234');
    await user.click(screen.getByRole('button', { name: 'Añadir' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/integración Matter activa/);
  });
});
