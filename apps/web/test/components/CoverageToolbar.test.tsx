import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CoverageToolbar } from '@/components/coverage/CoverageToolbar';
import { changeLocale, setLocale } from '@/lib/i18n';

function montar(over: { saving?: boolean; dirty?: boolean; tool?: 'select' | 'wall' } = {}) {
  return render(
    <CoverageToolbar
      tool={over.tool ?? 'select'}
      onToolChange={() => {}}
      wallMaterial="drywall"
      onWallMaterialChange={() => {}}
      onSave={() => {}}
      saving={over.saving}
      dirty={over.dirty}
      canEdit
    />,
  );
}

describe('CoverageToolbar: botón de guardar y material (issue #92)', () => {
  afterEach(() => setLocale('es', { persist: false }));

  it('en español conserva los tres estados carácter a carácter', () => {
    const { unmount } = montar({ dirty: true });
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeInTheDocument();
    unmount();
    const b = montar({ saving: true, dirty: true });
    expect(screen.getByRole('button', { name: 'Guardando…' })).toBeInTheDocument();
    b.unmount();
    montar({ dirty: false, tool: 'wall' });
    expect(screen.getByRole('button', { name: 'Guardado' })).toBeInTheDocument();
    expect(screen.getByText('Material')).toBeInTheDocument();
  });

  it('en inglés los tres estados salen en inglés', async () => {
    await act(async () => {
      await changeLocale('en', { persist: false });
    });
    const a = montar({ dirty: true });
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).toBeNull();
    a.unmount();
    const b = montar({ saving: true, dirty: true });
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeInTheDocument();
    b.unmount();
    montar({ dirty: false });
    expect(screen.getByRole('button', { name: 'Saved' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardado' })).toBeNull();
  });

  it('un cambio de idioma en caliente reetiqueta el botón', async () => {
    montar({ dirty: true });
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeInTheDocument();
    await act(async () => {
      await changeLocale('en', { persist: false });
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument(),
    );
  });
});

describe('CoverageToolbar: nombres sin depender de la etiqueta visible', () => {
  it('cada herramienta tiene nombre propio (aria-label)', () => {
    montar();
    for (const n of ['Seleccionar', 'Pared', 'Punto de acceso', 'Medir']) {
      expect(screen.getByRole('button', { name: n })).toHaveAttribute('aria-label', n);
    }
  });

  it('el selector de material tiene nombre propio', () => {
    montar({ tool: 'wall' });
    expect(screen.getByRole('combobox', { name: 'Material' })).toHaveAttribute(
      'aria-label',
      'Material',
    );
  });
});
