import type { WallMaterial } from '@krakenos/types';
import { WALL_MATERIALS } from '@krakenos/types';
import { MousePointer2, Ruler, Save, Slash, Wifi } from 'lucide-react';
import type { CoverageTool } from '@/components/coverage/FloorPlanStage';
import { Button } from '@/components/ui/button';
import { WALL_MATERIAL_LABELS } from '@/lib/coverage-format';
import { useT, type TranslationKey } from '@/lib/i18n';
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

const TOOLS: { id: CoverageTool; labelKey: TranslationKey; Icon: typeof MousePointer2 }[] = [
  { id: 'select', labelKey: 'coverage.toolbar.select', Icon: MousePointer2 },
  { id: 'wall', labelKey: 'coverage.toolbar.wall', Icon: Slash },
  { id: 'ap', labelKey: 'coverage.toolbar.ap', Icon: Wifi },
  { id: 'measure', labelKey: 'coverage.toolbar.measure', Icon: Ruler },
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
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-kr bg-kr-surface p-2">
      <div className="flex items-center gap-1" role="group" aria-label={t('coverage.toolbar.groupLabel')}>
        {TOOLS.map(({ id, labelKey, Icon }) => {
          const active = tool === id;
          const label = t(labelKey);
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
          <span className="hidden md:inline">{t('coverage.toolbar.material')}</span>
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
          {saving ? t('common.saving') : dirty ? t('common.saveChanges') : t('coverage.toolbar.saved')}
        </Button>
      </div>
    </div>
  );
}
