import type { UiMode, User } from '@krakenos/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { describeError } from '@/lib/errors';
import { useT, type TranslationKey } from '@/lib/i18n';
import { useAuthStore } from '@/store/auth.store';
import { toast } from '@/store/toast.store';
import { useState } from 'react';

const OPTIONS: { mode: UiMode; labelKey: TranslationKey; descKey: TranslationKey }[] = [
  { mode: 'simple', labelKey: 'settings.uiMode.simple', descKey: 'settings.uiMode.simpleDesc' },
  { mode: 'advanced', labelKey: 'settings.uiMode.advanced', descKey: 'settings.uiMode.advancedDesc' },
];

/**
 * Modo de la interfaz (US-176): preferencia por usuario, autoservicio. Solo
 * presentación — los permisos los impone el servidor en cada ruta.
 */
export function UiModeCard() {
  const t = useT();
  const user = useAuthStore((s) => s.user);
  const [saving, setSaving] = useState(false);
  const current: UiMode = user?.uiMode === 'simple' ? 'simple' : 'advanced';

  const change = async (mode: UiMode) => {
    if (mode === current || saving) return;
    setSaving(true);
    try {
      const updated = await api.patch<User>('/auth/ui-mode', { uiMode: mode });
      useAuthStore.setState({ user: updated });
      toast.success(t(mode === 'simple' ? 'settings.uiMode.simpleOn' : 'settings.uiMode.advancedOn'));
    } catch (err) {
      toast.error(describeError(err, t('settings.uiMode.error')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.uiMode.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className="grid gap-2 sm:grid-cols-2"
          role="group"
          aria-label={t('settings.uiMode.title')}
        >
          {OPTIONS.map((opt) => (
            <button
              key={opt.mode}
              type="button"
              aria-pressed={current === opt.mode}
              disabled={saving}
              onClick={() => void change(opt.mode)}
              className={cn(
                'rounded-lg border p-3 text-left transition-colors',
                current === opt.mode
                  ? 'border-kr-accent bg-kr-accent-faint'
                  : 'border-kr bg-kr-elevated hover:border-kr-accent-glow',
              )}
            >
              <span className="block font-medium text-kr-primary">{t(opt.labelKey)}</span>
              <span className="block text-kr-xs text-kr-muted">{t(opt.descKey)}</span>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
