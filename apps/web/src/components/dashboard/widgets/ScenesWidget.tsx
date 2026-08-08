import type { Scene } from '@krakenos/types';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingLine } from '@/components/ui/loading-line';
import { describeError } from '@/lib/errors';
import { useScenes } from '@/lib/resources';
import { runScene, sceneGlyph } from '@/lib/scenes';
import { canControlHome } from '@/lib/roles';
import { useAuthStore } from '@/store/auth.store';
import { toast } from '@/store/toast.store';
import { useT } from '@/lib/i18n';

/** Ejecuta escenas de un toque desde el dashboard (US-166). */
export function ScenesWidget() {
  const t = useT();
  const canControl = useAuthStore((s) => canControlHome(s.user?.role));
  // US-262: la misma lista que pide `QuickActionsWidget` en el mismo tick.
  const { data: scenes } = useScenes();
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (scene: Scene) => {
    setBusy(scene.id);
    try {
      const result = await runScene(scene.id);
      if (result.failed.length > 0) {
        toast.error(`${result.applied} aplicado(s), ${result.failed.length} sin responder`);
      } else {
        toast.success(`Escena «${scene.name}» activada`);
      }
    } catch (err) {
      toast.error(describeError(err, t('widget.scenes.runFailed')));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>{t('widget.scenes.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {scenes === null ? (
          <LoadingLine />
        ) : scenes.length === 0 ? (
          <p className="py-4 text-center text-kr-sm text-kr-muted">
            <Link to="/scenes" className="text-kr-link hover:underline">
              Crea tu primera escena →
            </Link>
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {scenes.slice(0, 6).map((scene) => (
              <button
                key={scene.id}
                type="button"
                disabled={!canControl || busy === scene.id}
                onClick={() => void run(scene)}
                className="flex min-h-[2.5rem] items-center gap-2 rounded-lg border border-kr bg-kr-elevated px-3 py-1.5 text-kr-sm text-kr-primary transition-colors hover:border-kr-accent disabled:opacity-50"
              >
                <span aria-hidden className="text-lg">
                  {sceneGlyph(scene.icon)}
                </span>
                {busy === scene.id ? t('widget.scenes.running') : scene.name}
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
