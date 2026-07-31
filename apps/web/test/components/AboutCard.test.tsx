import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { AboutCard } from '@/components/settings/AboutCard';

/**
 * US-257 — la tarjeta «Acerca de» no es decoración: es la forma en que la
 * instalación cumple la §13 de la AGPL (ofrecer el código a quien usa el
 * programa por red). Por eso se comprueban los enlaces **de verdad**, no solo
 * que la tarjeta aparezca.
 */
describe('AboutCard (US-257)', () => {
  it('declara la licencia y enlaza al código fuente y al texto de la licencia', () => {
    render(<AboutCard />);

    expect(screen.getByText(/AGPL-3\.0-or-later/)).toBeInTheDocument();

    const fuente = screen.getByRole('link', { name: /código fuente/i });
    expect(fuente).toHaveAttribute('href', 'https://github.com/Flores-rivera-24/krakenos');
    expect(fuente).toHaveAttribute('rel', expect.stringContaining('noopener'));

    const licencia = screen.getByRole('link', { name: /licencia/i });
    expect(licencia).toHaveAttribute(
      'href',
      'https://github.com/Flores-rivera-24/krakenos/blob/main/LICENSE',
    );
  });

  it('avisa de que los enlaces abren una pestaña nueva, sin romper el nombre visible', () => {
    render(<AboutCard />);
    // WCAG 2.5.3: el nombre accesible empieza por el texto que se ve.
    const fuente = screen.getByRole('link', { name: 'Ver el código fuente (se abre en una pestaña nueva)' });
    expect(fuente).toHaveTextContent('Ver el código fuente');
  });

  it('explica que el copyleft solo entra al distribuir, sin asustar a quien la usa en casa', () => {
    render(<AboutCard />);
    expect(screen.getByText(/sin ninguna obligación/i)).toBeInTheDocument();
  });

  it('no depende de ninguna petición: un fallo de red no deja la instalación sin licencia', () => {
    render(<AboutCard />);
    expect(apiMock.get).not.toHaveBeenCalled();
    expect(apiMock.post).not.toHaveBeenCalled();
  });
});
