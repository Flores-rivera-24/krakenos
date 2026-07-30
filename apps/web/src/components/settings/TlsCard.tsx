import type { TlsDisabledFeature, TlsStatus } from '@krakenos/types';
import { Lock, LockOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Callout } from '@/components/ui/callout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { useT, type TranslationKey } from '@/lib/i18n';

/**
 * Estado del TLS de la instalación (US-241).
 *
 * Existe porque **tres features entregadas estaban inertes y nada lo decía**: sin
 * contexto seguro no hay app instalable (US-234), ni avisos push (US-45), ni
 * passkeys (US-50/51). El usuario las veía en la app, las configuraba y no
 * funcionaban, sin ninguna pista de por qué.
 *
 * Y cuando **sí** hay HTTPS, avisa antes de que el certificado caduque: el de
 * Tailscale dura 90 días, así que la instalación se rompe sola tres meses después
 * de montarla si nadie mira.
 */

const FEATURE_KEY: Record<TlsDisabledFeature, TranslationKey> = {
  pwa: 'settings.tls.feature.pwa',
  push: 'settings.tls.feature.push',
  passkeys: 'settings.tls.feature.passkeys',
};

export function TlsCard() {
  const t = useT();
  const [status, setStatus] = useState<TlsStatus | null>(null);

  useEffect(() => {
    let active = true;
    void api
      .get<TlsStatus>('/system/tls')
      // ⚠️ El genérico de `api.get<T>()` es un CAST, no una comprobación (gotcha de
      // US-263): si la respuesta no trae la forma esperada, pintar a ciegas revienta
      // la página de Ajustes entera. Se valida lo que se va a recorrer.
      .then((s) => {
        if (active && s && typeof s === 'object' && Array.isArray(s.disabledFeatures)) {
          setStatus(s);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!status) return null;

  const secure = status.enabled || status.behindProxy;
  const sourceKey: TranslationKey =
    status.source === 'tailscale'
      ? 'settings.tls.source.tailscale'
      : status.source === 'self-signed'
        ? 'settings.tls.source.selfSigned'
        : 'settings.tls.source.unknown';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          {secure ? (
            <Lock size={20} className="text-success" aria-hidden />
          ) : (
            <LockOpen size={20} className="text-warning" aria-hidden />
          )}
          <CardTitle>{t('settings.tls.title')}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-kr-sm">
        <p className="text-kr-secondary">
          {secure ? t('settings.tls.on') : t('settings.tls.off')}
          {status.behindProxy && !status.enabled && ` · ${t('settings.tls.behindProxy')}`}
        </p>

        {/* Sin contexto seguro: se nombra UNA POR UNA la función que no va, en vez
            de un genérico «se recomienda HTTPS» que nadie relaciona con su push
            que no llega. */}
        {status.disabledFeatures.length > 0 && (
          <Callout variant="warning" standing title={t('settings.tls.disabledTitle')}>
            <ul className="list-inside list-disc space-y-0.5">
              {status.disabledFeatures.map((f) => (
                <li key={f}>{t(FEATURE_KEY[f])}</li>
              ))}
            </ul>
            <p className="pt-1">{t('settings.tls.howTo')}</p>
          </Callout>
        )}

        {status.enabled && status.notAfter && (
          <dl className="grid grid-cols-2 gap-2">
            <div>
              <dt className="text-kr-xs text-kr-muted">{t('settings.tls.sourceLabel')}</dt>
              <dd className="text-kr-primary">{t(sourceKey)}</dd>
            </div>
            <div>
              <dt className="text-kr-xs text-kr-muted">{t('settings.tls.expiresLabel')}</dt>
              <dd className="text-kr-primary">
                {new Date(status.notAfter).toLocaleDateString()}
                {status.daysLeft !== null && !status.expired && (
                  <span className="ml-1 text-kr-xs text-kr-muted">
                    {t('settings.tls.daysLeft', { n: status.daysLeft })}
                  </span>
                )}
              </dd>
            </div>
          </dl>
        )}

        {/* Un certificado caducado o a punto no es una nota al pie: cuando pasa,
            deja de entrar todo el mundo. */}
        {status.expired ? (
          <Callout variant="danger" standing title={t('settings.tls.expiredTitle')}>
            {t('settings.tls.expiredDesc')}
          </Callout>
        ) : status.expiring ? (
          <Callout variant="warning" standing title={t('settings.tls.expiringTitle')}>
            {t('settings.tls.expiringDesc', { n: status.daysLeft ?? 0 })}
          </Callout>
        ) : null}

        {/* El autofirmado cifra pero no lo avala nadie: decirlo evita el «pues a mí
            me sale que no es seguro» de cada dispositivo nuevo de la casa. */}
        {status.source === 'self-signed' && (
          <p className="text-kr-xs text-kr-muted">{t('settings.tls.selfSignedNote')}</p>
        )}
      </CardContent>
    </Card>
  );
}
