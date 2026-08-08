import type { SetupStatus } from '@krakenos/types';
import { ArrowRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LogoMark } from '@/components/ui/logo';
import { NetworkCanvas } from '@/components/ui/network-canvas';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';

/**
 * Portada pública (US-266). Es lo que ve en `/` quien no tiene sesión.
 *
 * Existe por dos motivos, y el segundo es el que la justifica:
 *
 * 1. La instalación no tenía ninguna superficie que dijera qué es esto. Quien
 *    abría la dirección por primera vez se encontraba un formulario y nada más.
 * 2. **Dice en qué estado está la instalación.** Si todavía no hay administrador,
 *    la acción principal es crearlo, no iniciar sesión: antes, quien llegaba a una
 *    instalación recién montada veía un login que no podía superar, sin una sola
 *    pista de que lo que le tocaba era el asistente.
 *
 * Lo que **no** hace: prometer cifras. Los tres reclamos son hechos comprobables
 * del repositorio (dónde corre, que no hay cuota, qué licencia tiene), no medidas
 * de una casa que el visitante no tiene. Tampoco dice «sin cuentas de fabricante»,
 * que sería mentira: hay integraciones que las piden y el propio sistema lo declara
 * en la tabla de compatibilidad.
 */
export function WelcomePage() {
  const t = useT();
  // `null` mientras no se sabe: la llamada puede fallar (agente caído) y entonces
  // no se puede afirmar ni una cosa ni la otra. En ese caso se ofrece «Entrar»,
  // que es la acción que no rompe nada si resulta ser la equivocada.
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    void api
      .get<SetupStatus>('/setup/status')
      .then((s) => {
        if (active) setNeedsSetup(s.needsSetup);
      })
      .catch(() => {
        if (active) setNeedsSetup(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const claims = [
    { title: t('welcome.claim.local'), detail: t('welcome.claim.localDetail') },
    { title: t('welcome.claim.noFee'), detail: t('welcome.claim.noFeeDetail') },
    { title: t('welcome.claim.source'), detail: t('welcome.claim.sourceDetail') },
  ];

  return (
    <div className="relative min-h-screen overflow-hidden bg-kr-base">
      <NetworkCanvas variant="fabric" />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-8 sm:px-10">
        <header className="flex items-center gap-2.5">
          <LogoMark className="h-7 w-7 text-kr-accent" draw />
          <span className="text-kr-lg font-semibold tracking-tight text-kr-primary">KrakenOS</span>
        </header>

        <main className="flex flex-1 flex-col justify-center py-12">
          <p className="text-kr-sm tracking-[0.18em] text-kr-muted">{t('welcome.eyebrow')}</p>
          <h1 className="mt-4 max-w-[16ch] text-[clamp(2.1rem,7vw,4rem)] font-semibold leading-[1.02] tracking-[-0.035em] text-kr-primary">
            {t('welcome.title')}
          </h1>
          <p className="mt-5 max-w-[52ch] text-kr-base text-kr-secondary">{t('welcome.subtitle')}</p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            {needsSetup === true ? (
              <>
                <Link
                  to="/setup"
                  className="inline-flex items-center gap-2 rounded-lg bg-kr-accent px-5 py-2.5 text-kr-base font-medium text-white transition-colors hover:bg-kr-accent-hover"
                >
                  {t('welcome.createAdmin')}
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
                <p className="text-kr-sm text-kr-secondary">{t('welcome.needsSetupHint')}</p>
              </>
            ) : (
              <Link
                to="/login"
                className="inline-flex items-center gap-2 rounded-lg bg-kr-accent px-5 py-2.5 text-kr-base font-medium text-white transition-colors hover:bg-kr-accent-hover"
              >
                {t('welcome.enter')}
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            )}
          </div>
        </main>

        <footer className="grid gap-6 border-t border-kr pt-6 sm:grid-cols-3">
          {claims.map((c) => (
            <div key={c.title}>
              <p className="text-kr-base font-medium text-kr-primary">{c.title}</p>
              <p className="mt-1 text-kr-sm text-kr-secondary">{c.detail}</p>
            </div>
          ))}
        </footer>
      </div>
    </div>
  );
}
