import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PerDeviceTrafficNotice } from '@/components/traffic/PerDeviceTrafficNotice';

/**
 * US-251. Lo que estos tests protegen es la **distinción**, no el render: los dos
 * motivos para no ver desglose se ven igual desde fuera (una lista vacía) y llevan
 * al usuario a sitios opuestos — uno a comprar otro router, el otro a teclear un
 * comando. Confundirlos es exactamente el fallo que US-263 fue a arreglar.
 */
describe('PerDeviceTrafficNotice (US-251)', () => {
  const props = {
    unsupportedTitle: 'Tu router no reparte el tráfico por dispositivo',
    unsupportedDesc: 'Solo informa del total de la casa.',
  };

  it('con la capacidad disponible no dice nada: el vacío ya significa «aún no hay datos»', () => {
    const { container } = render(
      <PerDeviceTrafficNotice capability={{ status: 'supported' }} {...props} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('cuando el router NO puede, lo dice sin pedirle nada al usuario', () => {
    render(<PerDeviceTrafficNotice capability={{ status: 'unsupported' }} {...props} />);
    expect(screen.getByText(props.unsupportedTitle)).toBeInTheDocument();
    expect(screen.getByText(props.unsupportedDesc)).toBeInTheDocument();
    // No se le manda a instalar nada: aquí no hay nada que instalar.
    expect(screen.queryByText(/nlbwmon/)).not.toBeInTheDocument();
  });

  it('cuando SÍ puede pero falta el paquete, dice el comando exacto', () => {
    render(
      <PerDeviceTrafficNotice
        capability={{ status: 'requires-setup', setup: 'nlbwmon' }}
        {...props}
      />,
    );
    expect(
      screen.getByText('Tu router puede dar este dato, pero le falta un paquete'),
    ).toBeInTheDocument();
    expect(screen.getByText(/opkg install nlbwmon/)).toBeInTheDocument();
    // Y NO se acusa al router de no poder, que llevaría a cambiar de hardware.
    expect(screen.queryByText(props.unsupportedTitle)).not.toBeInTheDocument();
  });

  it('los avisos permanentes no interrumpen al lector de pantalla (US-235)', () => {
    render(<PerDeviceTrafficNotice capability={{ status: 'unsupported' }} {...props} />);
    // `role="note"`, no `alert`: lleva ahí desde que cargó la página.
    expect(screen.getByRole('note')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
