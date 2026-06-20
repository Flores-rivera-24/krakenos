import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CompatibilityPage } from '@/pages/CompatibilityPage';

describe('CompatibilityPage', () => {
  it('renderiza el título y el mapa como imagen estática', () => {
    render(<CompatibilityPage />);
    expect(screen.getByText('Compatibilidad de hardware')).toBeInTheDocument();
    const img = screen.getByRole('img', { name: /mapa de compatibilidad/i });
    expect(img).toHaveAttribute('src', '/hardware_compatibility_map.svg');
  });
});
