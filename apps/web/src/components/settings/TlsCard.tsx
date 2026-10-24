import type { TlsDisabledFeature, TlsStatus } from '@krakenos/types';
import { Download, Lock, LockOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Accordion, AccordionItem } from '@/components/ui/accordion';
import { buttonVariants } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { WidgetError } from '@/components/ui/widget-error';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useT, type TranslationKey } from '@/lib/i18n';
import '@/lib/i18n/catalog/fragments/ajustes';

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

/** Pasos por sistema para instalar la CA local: claves del catálogo, en orden. */
const CA_STEPS: { os: 'windows' | 'macos' | 'android' | 'ios'; steps: TranslationKey[] }[] = [
  {
    os: 'windows',
    steps: [
      'settings.tls.ca.windows.1',
      'settings.tls.ca.windows.2',
      'settings.tls.ca.windows.3',
      'settings.tls.ca.windows.4',
    ],
  },
  {
    os: 'macos',
    steps: ['settings.tls.ca.macos.1', 'settings.tls.ca.macos.2', 'settings.tls.ca.macos.3'],
  },
  {
    os: 'android',
    steps: ['settings.tls.ca.android.1', 'settings.tls.ca.android.2', 'settings.tls.ca.android.3'],
  },
  {
    os: 'ios',
    steps: ['settings.tls.ca.ios.1', 'settings.tls.ca.ios.2', 'settings.tls.ca.ios.3'],
  },
];

const CA_OS_KEY: Record<'windows' | 'macos' | 'android' | 'ios', TranslationKey> = {
  windows: 'settings.tls.ca.os.windows',
  macos: 'settings.tls.ca.os.macos',
  android: 'settings.tls.ca.os.android',
  ios: 'settings.tls.ca.os.ios',
};

export function TlsCard() {
  const t = useT();
  const [status, setStatus] = useState<TlsStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let active = true;
    void api
      .get<TlsStatus>('/system/tls')
      // ⚠️ El genérico de `api.get<T>()` es un CAST, no una comprobación (gotcha de
      // US-263): si la respuesta no trae la forma esperada, pintar a ciegas revienta
      // la página de Ajustes entera. Se valida lo que se va a recorrer.
      .then((s) => {
        if (!active) return;
        if (s && typeof s === 'object' && Array.isArray(s.disabledFeatures)) {
          setStatus(s);
          setFailed(false);
        } else {
          setFailed(true);
        }
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [intento]);

  if (!status && failed) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.tls.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <WidgetError
            message={t('settings.tls.loadError')}
            onRetry={() => setIntento((n) => n + 1)}
          />
        </CardContent>
      </Card>
    );
  }
  if (!status) return null;

  const secure = status.enabled || status.behindProxy;
  const sourceKey: TranslationKey =
    status.source === 'tailscale'
      ? 'settings.tls.source.tailscale'
      : status.source === 'local-ca'
        ? 'settings.tls.source.localCa'
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
                {formatDate(status.notAfter)}
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

        {/* CA local: el cert del servidor solo lo avala quien instale la CA. Se
            descarga con un enlace directo, no con fetch+blob: la ruta es PÚBLICA y
            responde `Content-Disposition: attachment`, y en iOS Safari la descarga
            por navegación es la que ofrece instalar el perfil (un blob no). */}
        {status.source === 'local-ca' && (
          <section className="space-y-3 border-t border-kr pt-3" aria-labelledby="tls-ca-title">
            <h3 id="tls-ca-title" className="font-medium text-kr-primary">
              {t('settings.tls.ca.title')}
            </h3>
            <p className="text-kr-secondary">{t('settings.tls.ca.intro')}</p>
            <a href="/api/system/ca-cert" className={buttonVariants({ variant: 'outline' })}>
              <Download size={16} aria-hidden />
              {t('settings.tls.ca.download')}
            </a>
            <Accordion type="single">
              {CA_STEPS.map(({ os, steps }) => (
                <AccordionItem key={os} id={`tls-ca-${os}`} title={t(CA_OS_KEY[os])}>
                  <ol className="list-inside list-decimal space-y-1 text-kr-secondary">
                    {steps.map((k) => (
                      <li key={k}>{t(k)}</li>
                    ))}
                  </ol>
                </AccordionItem>
              ))}
            </Accordion>
            <p className="text-kr-xs text-kr-muted">{t('settings.tls.ca.firefox')}</p>
            <p className="text-kr-xs text-kr-muted">{t('settings.tls.ca.scope')}</p>
          </section>
        )}

        {/* El autofirmado cifra pero no lo avala nadie: decirlo evita el «pues a mí
            me sale que no es seguro» de cada dispositivo nuevo de la casa. */}
        {status.source === 'self-signed' && (
          <p className="text-kr-xs text-kr-muted">{t('settings.tls.selfSignedNote')}</p>
        )}
      </CardContent>
    </Card>
  );
}
