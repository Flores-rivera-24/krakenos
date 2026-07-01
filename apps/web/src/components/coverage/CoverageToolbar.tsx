import type { WallMaterial } from '@krakenos/types';
import { WALL_MATERIALS } from '@krakenos/types';
import { MousePointer2, Ruler, Save, Slash, Wifi } from 'lucide-react';
import type { CoverageTool } from '@/components/coverage/FloorPlanStage';
import { Button } from '@/components/ui/button';
import { WALL_MATERIAL_LABELS } from '@/lib/coverage-format';
import { cn } from '@/lib/utils';

interface Props {
  tool: CoverageTool;
  onToolChange: (tool: CoverageTool) => void;
  wallMaterial: WallMaterial;
  onWallMaterialChange: (material: WallMaterial) => void;
  /** Guarda el plano editado. */
  onSave: () => void;
  saving?: boolean;
  /** Hay cambios sin guardar. */
  dirty?: boolean;
  /** Solo `admin` puede editar/guardar; a `viewer` se le deshabilita. */
  canEdit?: boolean;
}

const TOOLS: { id: CoverageTool; label: string; Icon: typeof MousePointer2 }[] = [
  { id: 'select', label: 'Seleccionar', Icon: MousePointer2 },
  { id: 'wall', label: 'Pared', Icon: Slash },
  { id: 'ap', label: 'Punto de acceso', Icon: Wifi },
  { id: 'measure', label: 'Medir', Icon: Ruler },
];

/**
 * Barra de herramientas del editor de plano: selección/pared/AP/medición, el
 * material de las paredes nuevas y el botón Guardar. El estado vive en la página
 * (`CoveragePage`); esto solo lo presenta. Deshabilitada para `viewer`.
 */
export function CoverageToolbar({
  tool,
  onToolChange,
  wallMaterial,
  onWallMaterialChange,
  onSave,
  saving = false,
  dirty = false,
  canEdit = false,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-kr bg-kr-surface p-2">
      <div className="flex items-center gap-1" role="group" aria-label="Herramientas del plano">
        {TOOLS.map(({ id, label, Icon }) => {
          const active = tool === id;
          return (
            <button
              key={id}
              type="button"
              disabled={!canEdit}
              aria-pressed={active}
              title={label}
              onClick={() => onToolChange(id)}
              className={cn(
                'flex h-9 items-center gap-1.5 rounded-md px-2.5 text-kr-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                active
                  ? 'bg-kr-accent text-white'
                  : 'text-kr-secondary hover:bg-kr-elevated hover:text-kr-primary',
              )}
            >
              <Icon className="h-5 w-5" aria-hidden />
              <span className="hidden sm:inline">{label}</span>
            </button>
          );
        })}
      </div>

      {tool === 'wall' && (
        <label className="flex items-center gap-2 text-kr-sm text-kr-secondary">
          <span className="hidden md:inline">Material</span>
          <select
            value={wallMaterial}
            disabled={!canEdit}
            onChange={(e) => onWallMaterialChange(e.target.value as WallMaterial)}
            className="h-9 rounded-md border border-kr bg-kr-bg px-2 text-kr-sm text-kr-primary disabled:opacity-50"
          >
            {WALL_MATERIALS.map((m) => (
              <option key={m} value={m}>
                {WALL_MATERIAL_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="ml-auto">
        <Button size="sm" onClick={onSave} disabled={!canEdit || saving || !dirty}>
          <Save className="h-4 w-4" aria-hidden />
          {saving ? 'Guardando…' : dirty ? 'Guardar cambios' : 'Guardado'}
        </Button>
      </div>
    </div>
  );
}
