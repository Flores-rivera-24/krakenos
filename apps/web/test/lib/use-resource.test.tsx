import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TTL_RECURSO_MS, invalidarRecurso, limpiarRecursos, useResource } from '@/lib/use-resource';

/**
 * Caché y single-flight de las lecturas (US-262).
 *
 * Lo que se aserta aquí es el **número de peticiones**, no el dato: el dato ya lo
 * comprueban los consumidores. Lo que este hook promete es que tres widgets que
 * piden lo mismo no lo pidan tres veces, y eso solo se ve contando.
 */

function Consumidor({
  clave,
  fetcher,
  etiqueta = 'a',
}: {
  clave: string;
  fetcher: () => Promise<string[]>;
  etiqueta?: string;
}) {
  const { data, error, loading } = useResource(clave, fetcher);
  return (
    <div>
      <span data-testid={`estado-${etiqueta}`}>
        {loading ? 'cargando' : error ? 'error' : (data?.join(',') ?? 'vacio')}
      </span>
    </div>
  );
}

describe('useResource', () => {
  beforeEach(() => {
    limpiarRecursos();
  });

  it('tres consumidores de la misma clave producen UNA petición', async () => {
    const fetcher = vi.fn().mockResolvedValue(['x']);
    render(
      <>
        <Consumidor clave="/iot/devices" fetcher={fetcher} etiqueta="a" />
        <Consumidor clave="/iot/devices" fetcher={fetcher} etiqueta="b" />
        <Consumidor clave="/iot/devices" fetcher={fetcher} etiqueta="c" />
      </>,
    );

    await waitFor(() => expect(screen.getByTestId('estado-a')).toHaveTextContent('x'));
    // Los tres ven el dato…
    expect(screen.getByTestId('estado-b')).toHaveTextContent('x');
    expect(screen.getByTestId('estado-c')).toHaveTextContent('x');
    // …y solo hubo una petición. Éste es el defecto que la historia va a cerrar.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('claves distintas NO se comparten', async () => {
    const iot = vi.fn().mockResolvedValue(['iot']);
    const escenas = vi.fn().mockResolvedValue(['escena']);
    render(
      <>
        <Consumidor clave="/iot/devices" fetcher={iot} etiqueta="a" />
        <Consumidor clave="/scenes" fetcher={escenas} etiqueta="b" />
      </>,
    );

    await waitFor(() => expect(screen.getByTestId('estado-a')).toHaveTextContent('iot'));
    expect(screen.getByTestId('estado-b')).toHaveTextContent('escena');
    expect(iot).toHaveBeenCalledTimes(1);
    expect(escenas).toHaveBeenCalledTimes(1);
  });

  it('montar de nuevo dentro del TTL no vuelve a pedir', async () => {
    const fetcher = vi.fn().mockResolvedValue(['x']);
    const primero = render(<Consumidor clave="/scenes" fetcher={fetcher} />);
    await waitFor(() => expect(screen.getByTestId('estado-a')).toHaveTextContent('x'));
    primero.unmount();

    render(<Consumidor clave="/scenes" fetcher={fetcher} />);
    // El dato aparece sin pasar por «cargando»: sale del caché.
    expect(screen.getByTestId('estado-a')).toHaveTextContent('x');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('pasado el TTL vuelve a pedir', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const fetcher = vi.fn().mockResolvedValue(['x']);
      const primero = render(<Consumidor clave="/scenes" fetcher={fetcher} />);
      await waitFor(() => expect(screen.getByTestId('estado-a')).toHaveTextContent('x'));
      primero.unmount();

      vi.advanceTimersByTime(TTL_RECURSO_MS + 1);
      render(<Consumidor clave="/scenes" fetcher={fetcher} />);
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    } finally {
      vi.useRealTimers();
    }
  });

  it('invalidar obliga a releer aunque el TTL siga vivo', async () => {
    const fetcher = vi.fn().mockResolvedValue(['x']);
    const primero = render(<Consumidor clave="/scenes" fetcher={fetcher} />);
    await waitFor(() => expect(screen.getByTestId('estado-a')).toHaveTextContent('x'));
    primero.unmount();

    // Es lo que llama una escritura: sin esto, la lista seguiría enseñando el
    // estado anterior a la mutación que el propio usuario acaba de hacer.
    invalidarRecurso('/scenes');
    render(<Consumidor clave="/scenes" fetcher={fetcher} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  });

  /**
   * US-234: un fallo no puede leerse como «no tienes nada». El hook entrega el
   * error y deja la decisión de presentación al consumidor.
   */
  it('un fallo llega como error, NUNCA como lista vacía', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('agente caído'));
    render(<Consumidor clave="/iot/devices" fetcher={fetcher} />);
    await waitFor(() => expect(screen.getByTestId('estado-a')).toHaveTextContent('error'));
  });

  it('el error NO se cachea: la siguiente lectura reintenta', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('corte de un segundo'))
      .mockResolvedValue(['ya va']);

    const primero = render(<Consumidor clave="/iot/devices" fetcher={fetcher} />);
    await waitFor(() => expect(screen.getByTestId('estado-a')).toHaveTextContent('error'));
    primero.unmount();

    // Sin esta propiedad, un corte de red de un segundo dejaría el widget roto
    // durante todo el TTL aunque el agente ya conteste.
    render(<Consumidor clave="/iot/devices" fetcher={fetcher} />);
    await waitFor(() => expect(screen.getByTestId('estado-a')).toHaveTextContent('ya va'));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('un fallo del resondeo no borra el dato que ya se enseñaba', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(['bueno']).mockRejectedValue(new Error('caído'));

    function ConRefetch() {
      const { data, error, refetch } = useResource<string[]>('/iot/devices', fetcher);
      return (
        <div>
          <span data-testid="dato">{data?.join(',') ?? 'vacio'}</span>
          <span data-testid="err">{error ? 'error' : 'ok'}</span>
          <button onClick={() => void refetch()}>releer</button>
        </div>
      );
    }

    render(<ConRefetch />);
    await waitFor(() => expect(screen.getByTestId('dato')).toHaveTextContent('bueno'));
    screen.getByRole('button', { name: 'releer' }).click();

    await waitFor(() => expect(screen.getByTestId('err')).toHaveTextContent('error'));
    // El dato previo sobrevive: vaciarlo convertiría un fallo puntual del sondeo
    // en un widget que se vacía solo delante del usuario.
    expect(screen.getByTestId('dato')).toHaveTextContent('bueno');
  });

  it('`enabled: false` no pide nada', () => {
    const fetcher = vi.fn().mockResolvedValue(['x']);
    function Apagado() {
      useResource('/iot/devices', fetcher, { enabled: false });
      return null;
    }
    render(<Apagado />);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('el caché no sobrevive a `limpiarRecursos()`', async () => {
    const fetcher = vi.fn().mockResolvedValue(['x']);
    const primero = render(<Consumidor clave="/scenes" fetcher={fetcher} />);
    await waitFor(() => expect(screen.getByTestId('estado-a')).toHaveTextContent('x'));
    primero.unmount();

    // Al cerrar sesión, y entre tests: un panel con roles sobre un dispositivo
    // compartido no puede arrastrar los datos del hogar de la sesión anterior.
    limpiarRecursos();
    render(<Consumidor clave="/scenes" fetcher={fetcher} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  });
});
