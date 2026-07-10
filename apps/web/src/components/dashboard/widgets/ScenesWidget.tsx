import type { Scene } from '@krakenos/types';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingLine } from '@/components/ui/loading-line';
import { describeError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { listScenes, runScene, sceneGlyph } from '@/lib/scenes';
import { canControlHome } from '@/lib/roles';
import { useAuthStore } from '@/store/auth.store';
import { toast } from '@/store/toast.store';

/** Ejecuta escenas de un toque desde el dashboard (US-166). */
export function ScenesWidget() {
  const t = useT();
  const canControl = useAuthStore((s) => canControlHome(s.user?.role));
  const [scenes, setScenes] = useState<Scene[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listScenes()
      .then((s) => active && setScenes(s))
      .catch(() => active && setScenes([]));
    return () => {
      active = false;
    };
  }, []);

  const run = async (scene: Scene) => {
    setBusy(scene.id);
    try {
      const result = await runScene(scene.id);
      if (result.failed.length > 0) {
        toast.error(
          t('dashboard.scene.partial', { applied: result.applied, failed: result.failed.length }),
        );
      } else {
        toast.success(t('dashboard.scene.activated', { name: scene.name }));
      }
    } catch (err) {
      toast.error(describeError(err, t('dashboard.scene.activateError')));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>{t('dashboard.widget.scenes.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {scenes === null ? (
          <LoadingLine />
        ) : scenes.length === 0 ? (
          <p className="py-4 text-center text-kr-sm text-kr-muted">
            <Link to="/scenes" className="text-kr-link hover:underline">
              {t('dashboard.widget.scenes.createFirst')}
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
                {busy === scene.id ? t('dashboard.scene.activating') : scene.name}
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
