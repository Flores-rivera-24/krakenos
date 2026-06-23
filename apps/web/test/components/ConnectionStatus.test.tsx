import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ConnectionStatus } from '@/components/layout/ConnectionStatus';
import { useConnectionStore } from '@/store/connection.store';

afterEach(() => useConnectionStore.setState({ status: 'connected' }));

describe('ConnectionStatus (US-94)', () => {
  it('renderiza el indicador "Sin conexión" cuando el stream está caído', () => {
    useConnectionStore.setState({ status: 'offline' });
    render(<ConnectionStatus collapsed={false} />);
    expect(screen.getByText('Sin conexión')).toBeInTheDocument();
    // El punto de estado expone la etiqueta accesible.
    expect(screen.getByLabelText('Sin conexión')).toBeInTheDocument();
  });

  it('muestra "Reconectando…" mientras el socket reintenta', () => {
    useConnectionStore.setState({ status: 'reconnecting' });
    render(<ConnectionStatus collapsed={false} />);
    expect(screen.getByText('Reconectando…')).toBeInTheDocument();
  });

  it('muestra "En tiempo real" cuando está conectado', () => {
    useConnectionStore.setState({ status: 'connected' });
    render(<ConnectionStatus collapsed={false} />);
    expect(screen.getByText('En tiempo real')).toBeInTheDocument();
  });

  it('colapsada oculta el texto pero conserva el punto accesible', () => {
    useConnectionStore.setState({ status: 'offline' });
    render(<ConnectionStatus collapsed={true} />);
    expect(screen.queryByText('Sin conexión')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Sin conexión')).toBeInTheDocument();
  });
});
