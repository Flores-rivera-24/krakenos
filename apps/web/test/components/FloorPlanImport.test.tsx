import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoverageImport from '@/lib/coverage-import';

const importMock = vi.hoisted(() => ({ importPlanFile: vi.fn() }));
vi.mock('@/lib/coverage-import', async (orig) => ({
  // Conserva PlanImportError (para instanceof) y las funciones puras; solo
  // sustituye la importación (que usa canvas/createImageBitmap, sin jsdom).
  ...(await orig<typeof CoverageImport>()),
  importPlanFile: importMock.importPlanFile,
}));

const coverageMock = vi.hoisted(() => ({
  createFloorPlan: vi.fn(),
  updateFloorPlan: vi.fn(),
  deleteFloorPlan: vi.fn(),
}));
vi.mock('@/lib/coverage', () => coverageMock);

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/store/toast.store', () => ({ toast: toastMock }));

import { PlanImportError } from '@/lib/coverage-import';
import { FloorPlanFormSlideover } from '@/components/coverage/FloorPlanFormSlideover';

const PNG_DATA_URL = 'data:image/webp;base64,AAAA';

function renderNew() {
  return render(
    <FloorPlanFormSlideover onClose={vi.fn()} onSaved={vi.fn()} onDeleted={vi.fn()} />,
  );
}

function pickFile(name = 'plano.png', type = 'image/png') {
  const input = document.getElementById('plan-bg') as HTMLInputElement;
  const file = new File(['x'], name, { type });
  fireEvent.change(input, { target: { files: [file] } });
}

describe('FloorPlanFormSlideover — importar plano (US-194)', () => {
  beforeEach(() => {
    importMock.importPlanFile.mockReset();
    toastMock.error.mockReset();
    toastMock.success.mockReset();
  });

  it('importa un fichero, normaliza y muestra la vista previa + Calibrar', async () => {
    importMock.importPlanFile.mockResolvedValue(PNG_DATA_URL);
    renderNew();
    pickFile();
    await waitFor(() => expect(importMock.importPlanFile).toHaveBeenCalled());
    const preview = (await screen.findByAltText(/Vista previa del plano/)) as HTMLImageElement;
    expect(preview.src).toContain('data:image/webp');
    expect(screen.getByRole('button', { name: /Calibrar escala/ })).toBeInTheDocument();
  });

  it('un PDF ilegible muestra un aviso honesto', async () => {
    importMock.importPlanFile.mockRejectedValue(new PlanImportError('pdf-unreadable'));
    renderNew();
    pickFile('plano.pdf', 'application/pdf');
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(toastMock.error.mock.calls[0]?.[0]).toMatch(/No pudimos leer este PDF/);
  });

  it('acepta imagen, PDF y Word en el input', () => {
    renderNew();
    const input = document.getElementById('plan-bg') as HTMLInputElement;
    expect(input.accept).toBe('image/*,application/pdf,.docx');
  });
});
