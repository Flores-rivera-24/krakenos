import type { IotDevice, Scene, SceneAction, SceneIcon } from '@krakenos/types';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { IotSchedulesSection } from '@/components/scenes/IotSchedulesSection';
import { Card, CardContent } from '@/components/ui/card';
import { DeleteButton } from '@/components/ui/delete-button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { FavoriteButton } from '@/components/ui/favorite-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Slideover } from '@/components/ui/slideover';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import {
  SCENE_ICONS,
  SCENE_TEMPLATES,
  type SceneTemplate,
  createScene,
  deleteScene,
  listScenes,
  runScene,
  sceneGlyph,
  updateScene,
} from '@/lib/scenes';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
import { useFavoritesStore } from '@/store/favorites.store';
import { toast } from '@/store/toast.store';

/** Tarjeta táctil de una escena con ejecución de un toque (US-166). */
function SceneTile({
  scene,
  isAdmin,
  onEdit,
}: {
  scene: Scene;
  isAdmin: boolean;
  onEdit: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const result = await runScene(scene.id);
      if (result.failed.length > 0) {
        toast.error(
          t('scenes.partial', { applied: result.applied, failed: result.failed.length }),
        );
      } else {
        toast.success(t('scenes.activated', { name: scene.name }));
      }
    } catch (err) {
      toast.error(describeError(err, t('scenes.activateError')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col">
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between">
          <button
            type="button"
            onClick={onEdit}
            disabled={!isAdmin}
            className="flex items-center gap-3 text-left disabled:cursor-default"
          >
            <span
              aria-hidden
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-kr-muted bg-kr-elevated text-2xl"
            >
              {sceneGlyph(scene.icon)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-kr-base font-medium text-kr-primary">
                {scene.name}
              </span>
              <span className="block text-kr-xs text-kr-muted">
                {t('scenes.deviceCount', { count: scene.actions.length })}
              </span>
            </span>
          </button>
          <FavoriteButton kind="scene" ref_={scene.id} label={scene.name} />
        </div>

        <Button
          className="mt-auto min-h-[2.75rem] w-full"
          disabled={busy}
          onClick={() => void run()}
        >
          {busy ? t('scenes.activating') : t('scenes.activate')}
        </Button>
      </CardContent>
    </Card>
  );
}

/** Fila de dispositivo en el editor: incluir + estado deseado. */
interface DraftAction {
  include: boolean;
  on: boolean;
  brightness: number | null;
}

function initialDraft(devices: IotDevice[], actions: SceneAction[]): Record<string, DraftAction> {
  const byId = new Map(actions.map((a) => [a.deviceId, a]));
  const draft: Record<string, DraftAction> = {};
  for (const d of devices) {
    const existing = byId.get(d.id);
    draft[d.id] = {
      include: existing !== undefined,
      on: existing?.on ?? d.on ?? true,
      brightness: existing?.brightness ?? d.brightness ?? null,
    };
  }
  return draft;
}

function SceneEditor({
  scene,
  devices,
  template,
  onClose,
  onSaved,
}: {
  scene: Scene | null;
  devices: IotDevice[];
  template: SceneTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const editing = scene !== null;
  const [name, setName] = useState(scene?.name ?? template?.name ?? '');
  const [icon, setIcon] = useState<SceneIcon>(scene?.icon ?? template?.icon ?? 'scene');
  const [draft, setDraft] = useState<Record<string, DraftAction>>(() => {
    const base = initialDraft(devices, scene?.actions ?? []);
    // Una plantilla preselecciona todas las luces con su preset.
    if (template) {
      for (const d of devices) {
        if (d.kind === 'light' || d.kind === 'plug') {
          base[d.id] = {
            include: true,
            on: template.preset.on,
            brightness: template.preset.brightness ?? base[d.id]?.brightness ?? null,
          };
        }
      }
    }
    return base;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Fila efectiva de un dispositivo: si llegó DESPUÉS de sembrar el draft (carga
   * tardía del snapshot IoT), cae a una fila por defecto en vez de crashear con
   * `draft[d.id]!` (AUD-12).
   */
  const rowFor = (d: IotDevice): DraftAction =>
    draft[d.id] ?? { include: false, on: d.on ?? true, brightness: d.brightness ?? null };

  const update = (d: IotDevice, patch: Partial<DraftAction>) =>
    setDraft((prev) => ({ ...prev, [d.id]: { ...rowFor(d), ...prev[d.id], ...patch } }));

  const capture = () => {
    setDraft((prev) => {
      const next = { ...prev };
      for (const d of devices) {
        if (d.on === null) continue;
        next[d.id] = { include: true, on: d.on, brightness: d.brightness };
      }
      return next;
    });
    toast.info(t('scenes.stateCaptured'));
  };

  const buildActions = (): SceneAction[] =>
    devices
      .filter((d) => draft[d.id]?.include)
      .map((d) => {
        const row = rowFor(d);
        const action: SceneAction = { deviceId: d.id, on: row.on };
        if (d.kind === 'light' && row.brightness !== null) action.brightness = row.brightness;
        return action;
      });

  const save = async () => {
    const trimmed = name.trim();
    if (trimmed === '') {
      setError(t('scenes.nameRequired'));
      return;
    }
    const actions = buildActions();
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await updateScene(scene.id, { name: trimmed, icon, actions });
        toast.success(t('scenes.updated'));
      } else {
        await createScene({ name: trimmed, icon, actions });
        toast.success(t('scenes.created'));
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(describeError(err, t('scenes.saveError')));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    try {
      await deleteScene(scene.id);
      toast.success(t('scenes.deleted'));
      onSaved();
      onClose();
    } catch (err) {
      toast.error(describeError(err, t('scenes.deleteError')));
    }
  };

  const controllable = devices.filter((d) => d.on !== null);

  return (
    <Slideover
      open
      onClose={onClose}
      title={editing ? t('scenes.editTitle') : t('scenes.new')}
      footer={
        <div className="space-y-2">
          {error && <p className="text-kr-sm text-danger">{error}</p>}
          <Button onClick={() => void save()} disabled={saving} className="w-full">
            {saving ? t('common.saving') : t('common.save')}
          </Button>
          {editing && (
            <DeleteButton onDelete={remove} variant="destructive" className="w-full">
              {t('scenes.deleteScene')}
            </DeleteButton>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="scene-name">{t('scenes.nameLabel')}</Label>
          <Input
            id="scene-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('scenes.namePlaceholder')}
            maxLength={60}
          />
        </div>
        <div className="space-y-2">
          <Label>{t('scenes.iconLabel')}</Label>
          <div className="grid grid-cols-5 gap-2">
            {SCENE_ICONS.map((opt) => (
              <button
                key={opt.icon}
                type="button"
                title={opt.label}
                aria-label={opt.label}
                aria-pressed={icon === opt.icon}
                onClick={() => setIcon(opt.icon)}
                className={cn(
                  'flex h-12 items-center justify-center rounded-lg border text-2xl transition-colors',
                  icon === opt.icon
                    ? 'border-kr-accent bg-kr-accent-faint'
                    : 'border-kr bg-kr-elevated hover:border-kr-muted',
                )}
              >
                {opt.glyph}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <Label>{t('scenes.devicesLabel')}</Label>
          <Button variant="outline" size="sm" onClick={capture} type="button">
            {t('scenes.captureState')}
          </Button>
        </div>

        {controllable.length === 0 ? (
          <p className="text-kr-sm text-kr-muted">
            {t('scenes.noControllable')}
          </p>
        ) : (
          <ul className="space-y-2">
            {controllable.map((d) => {
              const row = rowFor(d);
              return (
                <li key={d.id} className="rounded-lg border border-kr bg-kr-elevated p-3">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={row.include}
                      onChange={(e) => update(d, { include: e.target.checked })}
                      aria-label={t('scenes.includeDevice', { name: d.name })}
                    />
                    <span className="flex-1 truncate text-kr-sm text-kr-primary">{d.name}</span>
                    {row.include && (
                      <Switch
                        checked={row.on}
                        onCheckedChange={(v) => update(d, { on: v })}
                        aria-label={t('scenes.deviceState', { name: d.name })}
                      />
                    )}
                  </label>
                  {row.include && d.kind === 'light' && row.on && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-kr-xs text-kr-muted">{t('scenes.brightness')}</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={row.brightness ?? 100}
                        aria-label={t('scenes.deviceBrightness', { name: d.name })}
                        onChange={(e) => update(d, { brightness: Number(e.target.value) })}
                        className="flex-1 accent-primary"
                      />
                      <span className="w-8 text-right text-kr-xs text-kr-secondary">
                        {row.brightness ?? 100}%
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Slideover>
  );
}

export function ScenesPage() {
  const t = useT();
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const [scenes, setScenes] = useState<Scene[] | null>(null);
  const [devices, setDevices] = useState<IotDevice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Scene | null>(null);
  const [template, setTemplate] = useState<SceneTemplate | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const reload = useCallback(() => {
    void listScenes()
      .then((list) => {
        setScenes(list);
        setError(null);
      })
      .catch((err) => {
        // Sin esto la rama `=== null` dejaba el Skeleton brillando para siempre (AUD-13).
        setScenes((prev) => prev ?? []);
        setError(describeError(err, t('scenes.loadError')));
      });
  }, [t]);

  useEffect(() => {
    reload();
    void api
      .get<IotDevice[]>('/iot/devices')
      .then((list) => {
        setDevices(list);
        setDevicesError(null);
      })
      .catch((err) => {
        // El editor afirmaba "no hay luces" cuando en realidad falló la carga (AUD-12).
        setDevices([]);
        setDevicesError(describeError(err, t('scenes.devicesLoadError')));
      });
    void useFavoritesStore.getState().load();
  }, [reload, t]);

  const openNew = (tpl: SceneTemplate | null) => {
    setEditing(null);
    setTemplate(tpl);
    setEditorOpen(true);
  };
  const openEdit = (scene: Scene) => {
    setEditing(scene);
    setTemplate(null);
    setEditorOpen(true);
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{t('scenes.title')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('scenes.subtitle')}
          </p>
        </div>
        {isAdmin && <Button onClick={() => openNew(null)}>{t('scenes.new')}</Button>}
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}
      {devicesError && <ErrorBanner>{devicesError}</ErrorBanner>}

      {scenes === null ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-36 w-full rounded-xl" />
          ))}
        </div>
      ) : scenes.length === 0 ? (
        !error && (
          <div className="flex flex-col items-center gap-4 rounded-xl border border-kr bg-kr-surface py-12 text-center">
            <p className="text-kr-secondary">{t('scenes.empty')}</p>
            <p className="mx-auto max-w-md text-kr-sm text-kr-muted">
              {t('scenes.emptyHint')}
            </p>
            {isAdmin && (
              <div className="flex flex-wrap justify-center gap-2">
                {SCENE_TEMPLATES.map((tpl) => (
                  <Button key={tpl.name} variant="outline" onClick={() => openNew(tpl)}>
                    {sceneGlyph(tpl.icon)} {tpl.name}
                  </Button>
                ))}
                <Button onClick={() => openNew(null)}>{t('scenes.create')}</Button>
              </div>
            )}
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {scenes.map((scene) => (
            <SceneTile key={scene.id} scene={scene} isAdmin={isAdmin} onEdit={() => openEdit(scene)} />
          ))}
        </div>
      )}

      {/* Programación por horario (US-168): luces/enchufes/escenas a hora fija o solar. */}
      <div className="border-t border-kr-muted pt-6">
        <IotSchedulesSection devices={devices} scenes={scenes ?? []} isAdmin={isAdmin} />
      </div>

      {editorOpen && (
        <SceneEditor
          scene={editing}
          devices={devices}
          template={template}
          onClose={() => setEditorOpen(false)}
          onSaved={reload}
        />
      )}
    </div>
  );
}
