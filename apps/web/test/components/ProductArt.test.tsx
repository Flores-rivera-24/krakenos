import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ProductArt,
  deviceTypeToArtKind,
  iotKindToArtKind,
  apModelToArtKind,
} from '@/components/ui/product-art';

describe('product-art (US-161)', () => {
  it('mapea cada tipo de dispositivo del inventario a una ilustración', () => {
    expect(deviceTypeToArtKind('router')).toBe('router');
    expect(deviceTypeToArtKind('computer')).toBe('laptop');
    expect(deviceTypeToArtKind('phone')).toBe('phone');
    expect(deviceTypeToArtKind('tablet')).toBe('tablet');
    expect(deviceTypeToArtKind('tv')).toBe('tv');
    expect(deviceTypeToArtKind('printer')).toBe('printer');
    expect(deviceTypeToArtKind('iot')).toBe('iot-hub');
    expect(deviceTypeToArtKind('unknown')).toBe('unknown');
  });

  it('mapea los kinds de IoT (con fallback a iot-hub)', () => {
    expect(iotKindToArtKind('light')).toBe('bulb');
    expect(iotKindToArtKind('plug')).toBe('plug');
    expect(iotKindToArtKind('sensor')).toBe('sensor');
    expect(iotKindToArtKind('desconocido')).toBe('iot-hub');
  });

  it('los puntos de acceso colocables siempre son AP de techo', () => {
    expect(apModelToArtKind()).toBe('access-point');
  });

  it('renderiza la ilustración de un aparato como SVG decorativo por defecto', () => {
    const { container } = render(<ProductArt kind="router" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('expone un nombre accesible cuando se pasa `title`', () => {
    render(<ProductArt kind="camera" title="Cámara IP" />);
    expect(screen.getByRole('img', { name: 'Cámara IP' })).toBeInTheDocument();
  });

  it('usa un emblema para funciones abstractas (vpn/dns/firewall/qos)', () => {
    const { container } = render(<ProductArt kind="vpn" title="VPN" />);
    expect(screen.getByRole('img', { name: 'VPN' })).toBeInTheDocument();
    // el emblema dibuja un chasis SVG bajo el glifo
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
