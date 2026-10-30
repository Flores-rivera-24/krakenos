import type { WallMaterial } from '@krakenos/types';
import { WALL_MATERIALS } from '@krakenos/types';
import { MousePointer2, Ruler, Save, Slash, Wifi } from 'lucide-react';
import { useT, type TranslationKey } from '@/lib/i18n';
import type { CoverageTool } from '@/components/coverage/FloorPlanStage';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { WALL_MATERIAL_KEYS } from '@/lib/coverage-format';
import { cn } from '@/lib/utils';
import '@/lib/i18n/catalog/fragments/cobertura';

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

const TOOLS: { id: CoverageTool; label: TranslationKey; Icon: typeof MousePointer2 }[] = [
  { id: 'select', label: 'coverage.tool.select', Icon: MousePointer2 },
  { id: 'wall', label: 'coverage.tool.wall', Icon: Slash },
  { id: 'ap', label: 'coverage.tool.ap', Icon: Wifi },
  { id: 'measure', label: 'coverage.tool.measure', Icon: Ruler },
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
      <div className="flex items-center gap-1" role="group" aria-label={t('coverage.toolbar.label')}>
        {TOOLS.map(({ id, label, Icon }) => {
          const active = tool === id;
          return (
            <button
              key={id}
              type="button"
              disabled={!canEdit}
              aria-pressed={active}
              title={t(label)}
              aria-label={t(label)}
              onClick={() => onToolChange(id)}
              className={cn(
                'flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-md px-2.5 md:h-9 md:min-w-0 md:justify-start text-kr-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                active
                  ? 'bg-kr-accent text-white'
                  : 'text-kr-secondary hover:bg-kr-elevated hover:text-kr-primary',
              )}
            >
              <Icon className="h-5 w-5" aria-hidden />
              <span className="hidden sm:inline">{t(label)}</span>
            </button>
          );
        })}
      </div>

      {tool === 'wall' && (
        <label className="flex items-center gap-2 text-kr-sm text-kr-secondary">
          <span className="hidden md:inline">{t('coverage.toolbar.material')}</span>
          <Select
            aria-label={t('coverage.toolbar.material')}
            value={wallMaterial}
            disabled={!canEdit}
            onChange={(e) => onWallMaterialChange(e.target.value as WallMaterial)}
            className="w-auto"
          >
            {WALL_MATERIALS.map((m) => (
              <option key={m} value={m}>
                {t(WALL_MATERIAL_KEYS[m])}
              </option>
            ))}
          </Select>
        </label>
      )}

      <div className="ml-auto">
        <Button size="sm" onClick={onSave} disabled={!canEdit || saving || !dirty}>
          <Save className="h-4 w-4" aria-hidden />
          {saving
            ? t('common.saving')
            : dirty
              ? t('common.saveChanges')
              : t('coverage.toolbar.saved')}
        </Button>
      </div>
    </div>
  );
}
