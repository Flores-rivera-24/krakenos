import { LOCALES, type Locale, type User } from '@krakenos/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { describeError } from '@/lib/errors';
import { setLocale, useT, type TranslationKey } from '@/lib/i18n';
import { useAuthStore } from '@/store/auth.store';
import { toast } from '@/store/toast.store';
import { useState } from 'react';

const OPTIONS: { locale: Locale; labelKey: TranslationKey; descKey: TranslationKey }[] = [
  { locale: 'es', labelKey: 'settings.language.es', descKey: 'settings.language.esDesc' },
  { locale: 'en', labelKey: 'settings.language.en', descKey: 'settings.language.enDesc' },
];

/**
 * Idioma de la interfaz (US-177): preferencia por usuario, autoservicio. Aplica
 * el cambio en el acto (`setLocale`) y lo persiste en el servidor y el
 * dispositivo. Solo presentación — la authz no cambia.
 */
export function LanguageCard() {
  const t = useT();
  const user = useAuthStore((s) => s.user);
  const [saving, setSaving] = useState(false);
  const current: Locale = user?.locale === 'en' ? 'en' : 'es';

  const change = async (locale: Locale) => {
    if (locale === current || saving || !(LOCALES as readonly string[]).includes(locale)) return;
    setSaving(true);
    try {
      const updated = await api.patch<User>('/auth/locale', { locale });
      useAuthStore.setState({ user: updated });
      // Aplica y persiste en el dispositivo de inmediato (el efecto de App
      // también reaccionaría, pero así el toast ya sale en el idioma nuevo).
      setLocale(locale);
      toast.success(t('settings.language.changed'));
    } catch (err) {
      toast.error(describeError(err, t('settings.language.error')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.language.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className="grid gap-2 sm:grid-cols-2"
          role="group"
          aria-label={t('settings.language.title')}
        >
          {OPTIONS.map((opt) => (
            <button
              key={opt.locale}
              type="button"
              aria-pressed={current === opt.locale}
              disabled={saving}
              onClick={() => void change(opt.locale)}
              className={cn(
                'rounded-lg border p-3 text-left transition-colors',
                current === opt.locale
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
