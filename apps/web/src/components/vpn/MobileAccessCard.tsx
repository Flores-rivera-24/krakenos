import { Smartphone } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useT } from '@/lib/i18n';

const STEPS = [1, 2, 3] as const;

/**
 * Guía «Tu móvil en 3 pasos» (US-215): la experiencia de bolsillo completa —
 * PWA instalada + túnel automático + una sola dirección — sin abrir puertos.
 * Solo copy: la app no puede configurar el teléfono, pero sí guiar con honestidad.
 */
export function MobileAccessCard() {
  const t = useT();
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Smartphone size={20} className="text-kr-accent" aria-hidden />
          <CardTitle className="text-base text-foreground">{t('vpn.mobile.title')}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-kr-xs text-kr-secondary">{t('vpn.mobile.desc')}</p>
        <ol className="space-y-3">
          {STEPS.map((n) => (
            <li key={n} className="flex gap-3">
              <span
                aria-hidden
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-kr-accent/15 text-kr-sm font-semibold text-kr-accent"
              >
                {n}
              </span>
              <div className="min-w-0 space-y-1">
                <p className="font-medium">{t(`vpn.mobile.step${n}.title`)}</p>
                <p className="text-kr-xs text-kr-secondary">{t(`vpn.mobile.step${n}.desc`)}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="text-kr-xs text-kr-secondary">{t('vpn.mobile.note')}</p>
      </CardContent>
    </Card>
  );
}
