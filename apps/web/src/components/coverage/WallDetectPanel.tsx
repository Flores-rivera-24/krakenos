import { WALL_MATERIALS, type WallMaterial } from '@krakenos/types';
import { ScanLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WALL_MATERIAL_LABELS } from '@/lib/coverage-format';
import { useT } from '@/lib/i18n';
import type { ProposedWall } from '@/lib/wall-propose';

interface Props {
  /** ¿El plano tiene imagen de fondo sobre la que detectar? */
  hasImage: boolean;
  detecting: boolean;
  /** Propuestas pendientes de confirmar, o `null` si aún no se ha detectado. */
  proposed: ProposedWall[] | null;
  material: WallMaterial;
  onMaterialChange: (m: WallMaterial) => void;
  onDetect: () => void;
  onAccept: () => void;
  onDiscard: () => void;
  canEdit: boolean;
}

/**
 * Detección asistida de paredes (US-195). Ofrece detectar sobre la imagen de
 * fondo y, con las propuestas en pantalla (punteadas en el lienzo), elegir el
 * material y aceptarlas o descartarlas. **Nada se guarda sin confirmar**: al
 * aceptar se materializan como paredes normales del editor, que el usuario aún
 * puede ajustar o borrar a mano antes de guardar el plano.
 */
export function WallDetectPanel({
  hasImage,
  detecting,
  proposed,
  material,
  onMaterialChange,
  onDetect,
  onAccept,
  onDiscard,
  canEdit,
}: Props) {
  const t = useT();
  if (!canEdit) return null;

  return (
    <div className="rounded-xl border border-kr bg-kr-surface p-4 text-kr-sm">
      <p className="mb-2 font-medium text-kr-primary">{t('coverage.detect.title')}</p>

      {!hasImage ? (
        <p className="text-kr-muted">{t('coverage.detect.noImage')}</p>
      ) : (
        <div className="space-y-3">
          <p className="text-kr-xs text-kr-muted">{t('coverage.detect.hint')}</p>

          {proposed == null ? (
            <Button size="sm" disabled={detecting} onClick={onDetect}>
              <ScanLine className="h-4 w-4" aria-hidden />
              {detecting ? t('coverage.detect.detecting') : t('coverage.detect.button')}
            </Button>
          ) : proposed.length === 0 ? (
            <div className="space-y-2">
              <p className="text-kr-secondary">{t('coverage.detect.none')}</p>
              <Button size="sm" variant="outline" onClick={onDiscard}>
                {t('coverage.detect.discard')}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-kr-secondary">
                {t('coverage.detect.found', { count: proposed.length })}
              </p>
              <label className="flex items-center gap-2 text-kr-secondary">
                <span>{t('coverage.detect.material')}</span>
                <select
                  value={material}
                  onChange={(e) => onMaterialChange(e.target.value as WallMaterial)}
                  className="h-8 flex-1 rounded-md border border-kr bg-kr-bg px-2 text-kr-primary"
                >
                  {WALL_MATERIALS.map((m) => (
                    <option key={m} value={m}>
                      {WALL_MATERIAL_LABELS[m]}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex gap-2">
                <Button size="sm" onClick={onAccept}>
                  {t('coverage.detect.accept')}
                </Button>
                <Button size="sm" variant="outline" onClick={onDiscard}>
                  {t('coverage.detect.discard')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
