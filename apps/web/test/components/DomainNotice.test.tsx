import { render, screen } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoNoticeFor, DomainGate } from '@/components/integrations/DomainNotice';
import { GatewayCapabilityNotice } from '@/components/gateway/GatewayCapabilityNotice';
import { useEstadosStore } from '@/lib/integration-states';

const renderGate = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

afterEach(() => useEstadosStore.setState({ estados: null }));

describe('DomainGate', () => {
  const Cuerpo = ({ onMount }: { onMount?: () => void }) => {
    useState(() => onMount?.());
    return (
      <div>
        <h1>Mi página</h1>
        <p>contenido</p>
      </div>
    );
  };

  it('sin estado conocido enseña la página de siempre (ante la duda, no avisa de nada)', () => {
    renderGate(
      <DomainGate domain="vpn" title="VPN">
        <Cuerpo />
      </DomainGate>,
    );
    expect(screen.getByText('contenido')).toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('configured: la página, sin avisos', () => {
    useEstadosStore.setState({ estados: { vpn: 'configured' } });
    renderGate(
      <DomainGate domain="vpn" title="VPN">
        <Cuerpo />
      </DomainGate>,
    );
    expect(screen.getByText('contenido')).toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('not-configured: título + «Sin configurar» con el enlace a Conectar, y NO monta el cuerpo', () => {
    useEstadosStore.setState({ estados: { dns: 'not-configured' } });
    const onMount = vi.fn();
    renderGate(
      <DomainGate domain="dns" title="DNS">
        <Cuerpo onMount={onMount} />
      </DomainGate>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'DNS' })).toBeInTheDocument();
    expect(screen.getByText('Sin configurar')).toBeInTheDocument();
    expect(screen.getByText('Todavía no has conectado un bloqueador de DNS.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir a Conectar' })).toHaveAttribute('href', '/connect');
    // El cuerpo ni se monta: no pide datos que no existen ni pinta un vacío que culpe al usuario.
    expect(onMount).not.toHaveBeenCalled();
    expect(screen.queryByText('contenido')).not.toBeInTheDocument();
    // Exactamente un h1 en el DOM.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('not-configured con blockWhenNotConfigured={false}: la página se usa y no hay aviso', () => {
    useEstadosStore.setState({ estados: { iot: 'not-configured' } });
    renderGate(
      <DomainGate domain="iot" title="Escenas" blockWhenNotConfigured={false}>
        <Cuerpo />
      </DomainGate>,
    );
    expect(screen.getByText('contenido')).toBeInTheDocument();
    expect(screen.queryByText('Sin configurar')).not.toBeInTheDocument();
  });

  it('demo: aviso permanente «Datos de demostración» ENCIMA de una página que sí se pinta', () => {
    useEstadosStore.setState({ estados: { cameras: 'demo' } });
    renderGate(
      <DomainGate domain="cameras" title="Cámaras">
        <Cuerpo />
      </DomainGate>,
    );
    const aviso = screen.getByRole('note');
    expect(aviso).toHaveTextContent('Datos de demostración');
    expect(aviso).toHaveTextContent('Lo que ves aquí es de ejemplo, no de tu casa.');
    // Es `standing`: nunca un `alert` que interrumpa al lector de pantalla.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('contenido')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir a Conectar' })).toHaveAttribute('href', '/connect');
  });

  it('pasar de desconocido a demo NO remonta el cuerpo (no repite sus peticiones)', () => {
    const onMount = vi.fn();
    const { rerender } = renderGate(
      <DomainGate domain="cameras" title="Cámaras">
        <Cuerpo onMount={onMount} />
      </DomainGate>,
    );
    expect(onMount).toHaveBeenCalledTimes(1);
    useEstadosStore.setState({ estados: { cameras: 'demo' } });
    rerender(
      <MemoryRouter>
        <DomainGate domain="cameras" title="Cámaras">
          <Cuerpo onMount={onMount} />
        </DomainGate>
      </MemoryRouter>,
    );
    expect(screen.getByRole('note')).toBeInTheDocument();
    expect(onMount).toHaveBeenCalledTimes(1);
  });

  it('cada dominio dice lo suyo (8 frases distintas)', () => {
    const dominios = ['driver', 'vpn', 'iot', 'cameras', 'firewall', 'vlan', 'qos', 'dns'] as const;
    const frases = new Set<string>();
    for (const d of dominios) {
      useEstadosStore.setState({ estados: { [d]: 'not-configured' } });
      const { unmount } = renderGate(
        <DomainGate domain={d} title={d}>
          <Cuerpo />
        </DomainGate>,
      );
      frases.add(screen.getByRole('note').textContent ?? '');
      unmount();
    }
    expect(frases.size).toBe(dominios.length);
  });
});

describe('GatewayCapabilityNotice con not-configured', () => {
  it('es el MISMO aviso «Sin configurar» de las demás páginas, con el enlace a Conectar', () => {
    renderGate(
      <GatewayCapabilityNotice
        capability={{ status: 'not-configured', reason: 'not-configured' }}
        feature="firewall"
      />,
    );
    expect(screen.getByText('Sin configurar')).toBeInTheDocument();
    expect(
      screen.getByText('Todavía no has configurado el cortafuegos de este equipo.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir a Conectar' })).toBeInTheDocument();
    expect(screen.getAllByRole('note')).toHaveLength(1);
  });
});

describe('DemoNoticeFor', () => {
  it('solo sale con el dominio en demostración', () => {
    useEstadosStore.setState({ estados: { qos: 'configured' } });
    const { container, rerender } = renderGate(<DemoNoticeFor domain="qos" />);
    expect(container).toBeEmptyDOMElement();
    useEstadosStore.setState({ estados: { qos: 'demo' } });
    rerender(
      <MemoryRouter>
        <DemoNoticeFor domain="qos" />
      </MemoryRouter>,
    );
    expect(screen.getByText('Datos de demostración')).toBeInTheDocument();
  });
});
