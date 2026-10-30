import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

/**
 * Un borde de campo mide 3:1 contra la superficie donde se pinta (WCAG 1.4.11): `border-kr-field`.
 * `border-kr` (8 %/10 % de opacidad) se queda para tarjetas y tablas. El valor lo mide `check-contrast`;
 * aquí se ata que los controles USEN el token.
 */
describe('bordes de campo', () => {
  it('Input y Textarea usan border-kr-field y el anillo kr-ring', () => {
    render(
      <>
        <Input aria-label="campo" />
        <Textarea aria-label="area" />
      </>,
    );
    for (const nombre of ['campo', 'area']) {
      const el = screen.getByLabelText(nombre);
      expect(el.className).toContain('border-kr-field');
      expect(el.className).not.toContain('border-input');
      expect(el.className).toContain('focus-visible:ring-kr-ring');
    }
  });

  it('Select (que usan los ajustes) lleva border-kr-field', () => {
    render(<Select aria-label="lista" />);
    expect(screen.getByLabelText('lista').className).toContain('border-kr-field');
  });

  it('el botón destructivo pinta blanco sobre bg-kr-danger-solid', () => {
    render(<Button variant="destructive">Borrar</Button>);
    const b = screen.getByRole('button', { name: 'Borrar' });
    expect(b.className).toContain('bg-kr-danger-solid');
    expect(b.className).toContain('text-white');
  });

  it.each([
    'components/settings/SecuritySection.tsx',
    'components/settings/UsersSection.tsx',
    'components/settings/InvitationsCard.tsx',
    'components/settings/SystemBackupCard.tsx',
    'components/settings/TuyaManager.tsx',
    'components/coverage/CoverageToolbar.tsx',
    'components/coverage/SurveyPanel.tsx',
    'components/coverage/WallDetectPanel.tsx',
    'components/wifi/MainNetworkCard.tsx',
  ])('los selects de %s llevan border-kr-field', (ruta) => {
    const fuente = readFileSync(join(process.cwd(), 'src', ruta), 'utf8');
    // Un `<select>` a mano lleva el token; si no queda ninguno, el campo sale de `<Select>` (que ya lo trae).
    if (/<select\b/.test(fuente)) expect(fuente).toContain('border-kr-field');
    else expect(fuente).toMatch(/<Select\b/);
    // Ningún borde de campo a la antigua en una línea de clase de select/campo.
    expect(fuente).not.toMatch(/h-\d+[^'"`]*border border-(kr|input) /);
  });
});
