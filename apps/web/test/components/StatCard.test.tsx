import { render, screen } from '@testing-library/react';
import { Activity } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { StatCard } from '@/components/dashboard/StatCard';

describe('StatCard', () => {
  it('muestra título y valor', () => {
    render(<StatCard title="Dispositivos" value={12} icon={Activity} />);
    expect(screen.getByText('Dispositivos')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('muestra el hint cuando se proporciona', () => {
    render(<StatCard title="CPU" value="45%" hint="8 núcleos" icon={Activity} />);
    expect(screen.getByText('8 núcleos')).toBeInTheDocument();
  });

  it('omite el hint cuando no se proporciona', () => {
    render(<StatCard title="RAM" value="2 GB" icon={Activity} />);
    expect(screen.queryByText(/núcleos/)).not.toBeInTheDocument();
  });
});
