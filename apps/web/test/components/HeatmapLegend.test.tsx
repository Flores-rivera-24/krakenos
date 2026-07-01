import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HeatmapLegend } from '@/components/coverage/HeatmapLegend';

describe('HeatmapLegend', () => {
  it('muestra los límites por defecto del degradado en dBm', () => {
    render(<HeatmapLegend />);
    expect(screen.getByText('-85 dBm')).toBeInTheDocument();
    expect(screen.getByText('-45 dBm')).toBeInTheDocument();
    expect(screen.getByText('Intensidad de señal')).toBeInTheDocument();
  });

  it('respeta los límites personalizados', () => {
    render(<HeatmapLegend minDbm={-90} maxDbm={-40} />);
    expect(screen.getByText('-90 dBm')).toBeInTheDocument();
    expect(screen.getByText('-40 dBm')).toBeInTheDocument();
  });

  it('rinde las 5 categorías de calidad de señal', () => {
    render(<HeatmapLegend />);
    expect(screen.getByText('Excelente')).toBeInTheDocument();
    expect(screen.getByText('Buena')).toBeInTheDocument();
    expect(screen.getByText('Aceptable')).toBeInTheDocument();
    expect(screen.getByText('Débil')).toBeInTheDocument();
    expect(screen.getByText('Sin señal')).toBeInTheDocument();
  });

  it('expone la barra de degradado como imagen accesible', () => {
    render(<HeatmapLegend />);
    expect(
      screen.getByRole('img', { name: /Degradado de señal de -85 dBm a -45 dBm/ }),
    ).toBeInTheDocument();
  });
});
