import type { CompatibilityEntry } from '@krakenos/types';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const compatMock = vi.hoisted(() => ({ listCompatibility: vi.fn() }));
vi.mock('@/lib/compatibility', () => compatMock);

import { CompatibilitySection } from '@/components/connect/CompatibilitySection';

/**
 * ⚠️ Este fixture **mintió** hasta US-258: traía `support` y el servidor lo podaba
 * con `additionalProperties: false`, así que el aviso de «sin garantía» se veía aquí
 * y no en producción. Un fixture es lo que el componente recibiría **si el servidor
 * lo mandara**, y eso lo comprueba el test de contrato del agente
 * (`compatibility.routes.test.ts`), no este fichero.
 */
const CATALOG: CompatibilityEntry[] = [
  { id: 'driver:openwrt', category: 'driver', label: 'Router OpenWrt', capabilities: ['inventory', 'wifi'], requirements: ['address', 'credentials'], verifiedAt: null, support: 'core', appDependency: null },
  { id: 'iot:hue', category: 'iot', label: 'Philips Hue', capabilities: ['control'], requirements: ['address', 'credentials'], verifiedAt: null, support: 'core', appDependency: null },
  { id: 'dns:pihole', category: 'dns', label: 'Pi-hole', capabilities: ['dns-block'], requirements: ['address'], verifiedAt: '2026-08-07', support: 'core', appDependency: null },
  // US-238: uno solo en community, a propósito — con todo igual, invertir la
  // condición del aviso daría el mismo recuento y el test no probaría nada.
  { id: 'iot:tuya', category: 'iot', label: 'Tuya / Smart Life', capabilities: ['control'], requirements: ['extra-dependency'], verifiedAt: null, support: 'community', appDependency: { reason: 'pairing', scope: 'all' } },
  // US-258: el caso que no tenía marca posible — `core` (se mantiene) y aun así
  // parte del parque necesita la cuenta del fabricante.
  { id: 'iot:kasa', category: 'iot', label: 'TP-Link Kasa / Tapo', capabilities: ['control'], requirements: ['credentials'], verifiedAt: null, support: 'core', appDependency: { reason: 'account', scope: 'some', devices: 'Tapo' } },
];

describe('CompatibilitySection (US-208)', () => {
  it('avisa de «sin garantía» SOLO en los backends community (US-238)', async () => {
    render(<CompatibilitySection />);
    await screen.findByText('Tuya / Smart Life');
    const avisos = screen.getAllByText(/sin garantía/i);
    // Uno y solo uno: el aviso va pegado a Tuya, no a Hue ni al router.
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.closest('li')).toHaveTextContent('Tuya / Smart Life');
  });

  beforeEach(() => {
    compatMock.listCompatibility.mockReset().mockResolvedValue(CATALOG);
  });

  it('lista el catálogo con capacidades y el estado sin verificar', async () => {
    render(<CompatibilitySection />);
    expect(await screen.findByText('Router OpenWrt')).toBeInTheDocument();
    expect(screen.getByText('Philips Hue')).toBeInTheDocument();
    expect(screen.getAllByText('Soportado por código').length).toBeGreaterThan(0);
  });

  // --- US-258 ---

  it('la verificación se muestra con FECHA, y sin ella dice «sin verificar»', async () => {
    render(<CompatibilitySection />);
    await screen.findByText('Pi-hole');
    // Solo Pi-hole tiene fecha en el fixture: el recuento es asimétrico a
    // propósito, para que invertir la condición no dé el mismo número.
    const conFecha = screen.getAllByText(/Verificado con hardware el/);
    expect(conFecha).toHaveLength(1);
    expect(conFecha[0]!.closest('li')).toHaveTextContent('Pi-hole');
    expect(screen.getAllByText('Soportado por código')).toHaveLength(4);
  });

  it('avisa de la app del fabricante también en un backend `core` (Kasa/Tapo)', async () => {
    render(<CompatibilitySection />);
    await screen.findByText('TP-Link Kasa / Tapo');
    // Es el caso que se perdía: no es community, así que el sello de garantía no
    // sale — y el aviso de la cuenta sí tiene que salir.
    const kasa = screen.getByText('TP-Link Kasa / Tapo').closest('li')!;
    expect(kasa).toHaveTextContent('Necesita la cuenta del fabricante para funcionar.');
    expect(kasa).toHaveTextContent('Solo afecta a los Tapo.');
    expect(kasa).not.toHaveTextContent('sin garantía');
  });

  it('el aviso de la app dice QUÉ hace falta, no una frase genérica', async () => {
    render(<CompatibilitySection />);
    await screen.findByText('Tuya / Smart Life');
    const tuya = screen.getByText('Tuya / Smart Life').closest('li')!;
    expect(tuya).toHaveTextContent('el emparejamiento se hace contra su nube');
    // `scope: 'all'` → no se acota a ninguna gama.
    expect(tuya).not.toHaveTextContent('Solo afecta');
    // Y lo que no depende de ninguna app no lo dice. Se asierta contra «la app del
    // fabricante» y NO contra «Necesita», que aparece igualmente en la línea de
    // requisitos («Necesita: una dirección · credenciales») de cualquier ficha.
    expect(screen.getByText('Philips Hue').closest('li')).not.toHaveTextContent(
      'la app del fabricante',
    );
  });

  it('busca por marca/modelo', async () => {
    render(<CompatibilitySection />);
    await screen.findByText('Router OpenWrt');
    fireEvent.change(screen.getByLabelText('Buscar por marca o modelo'), { target: { value: 'hue' } });
    expect(screen.getByText('Philips Hue')).toBeInTheDocument();
    expect(screen.queryByText('Router OpenWrt')).not.toBeInTheDocument();
  });

  it('filtra por categoría', async () => {
    render(<CompatibilitySection />);
    await screen.findByText('Router OpenWrt');
    fireEvent.click(screen.getByRole('button', { name: 'DNS' }));
    expect(screen.getByText('Pi-hole')).toBeInTheDocument();
    expect(screen.queryByText('Philips Hue')).not.toBeInTheDocument();
  });

  it('es honesto cuando no encuentra el equipo', async () => {
    render(<CompatibilitySection />);
    await screen.findByText('Router OpenWrt');
    fireEvent.change(screen.getByLabelText('Buscar por marca o modelo'), { target: { value: 'zzz' } });
    expect(screen.getByText(/no significa que no funcione/)).toBeInTheDocument();
  });
});
