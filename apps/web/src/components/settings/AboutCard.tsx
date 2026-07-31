import { ExternalLink, Scale } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KRAKENOS_REPO } from '@/lib/feedback';
import { useT } from '@/lib/i18n';

/** Identificador SPDX declarado en `LICENSE` y en los `package.json` del workspace. */
export const LICENSE_SPDX = 'AGPL-3.0-or-later';
export const SOURCE_URL = `https://github.com/${KRAKENOS_REPO}`;
export const LICENSE_URL = `${SOURCE_URL}/blob/main/LICENSE`;

/**
 * Acerca de (US-257): licencia y **oferta de código fuente**.
 *
 * No es decorativa: la §13 de la AGPL exige que quien usa el programa a través
 * de la red pueda obtener su código. Por eso la tarjeta es visible para
 * **cualquier rol** —no solo admin— y no depende de ninguna petición: un fallo
 * de red no puede dejar la instalación sin cumplir su propia licencia.
 */
export function AboutCard() {
  const t = useT();
  /**
   * El nombre accesible **empieza** por el texto visible (WCAG 2.5.3) y añade
   * el aviso de pestaña nueva, que de otro modo solo se percibe con la vista.
   */
  const nuevaPestaña = (label: string) => t('settings.about.newTab', { label });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Scale className="h-5 w-5 text-kr-accent" aria-hidden />
          {t('settings.about.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-kr-sm text-kr-secondary">
          {t('settings.about.license', { license: LICENSE_SPDX })}
        </p>

        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <a
            href={SOURCE_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={nuevaPestaña(t('settings.about.source'))}
            className="inline-flex items-center gap-1.5 text-kr-sm text-kr-link hover:underline"
          >
            {t('settings.about.source')}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
          <a
            href={LICENSE_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={nuevaPestaña(t('settings.about.licenseText'))}
            className="inline-flex items-center gap-1.5 text-kr-sm text-kr-link hover:underline"
          >
            {t('settings.about.licenseText')}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        </div>

        <p className="text-kr-xs text-kr-muted">{t('settings.about.copyleft')}</p>
      </CardContent>
    </Card>
  );
}
