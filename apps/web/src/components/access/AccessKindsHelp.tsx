import { Callout } from '@/components/ui/callout';
import { useT } from '@/lib/i18n';

/**
 * Las **tres formas de cortar internet** (US-240), explicadas donde conviven.
 *
 * Pausa, horario y bloqueo aparecían adyacentes —en el detalle del dispositivo, y
 * ahora también por persona— sin nada que dijera en qué se diferencian. Las tres
 * dejan un aparato sin internet y las tres se ven igual desde fuera; lo que cambia
 * es **cuándo vuelve**, que es justo la pregunta que se hace quien las usa. Sin
 * eso, la salida natural del usuario es bloquear a mano «por si acaso» y luego no
 * entender por qué su hija sigue sin internet a las once de la mañana.
 *
 * Es `standing`: una advertencia permanente no debe interrumpir al lector de
 * pantalla al montar (US-235).
 */
export function AccessKindsHelp({ className }: { className?: string }) {
  const t = useT();
  const kinds = [
    { term: t('access.kinds.pause'), desc: t('access.kinds.pauseDesc') },
    { term: t('access.kinds.schedule'), desc: t('access.kinds.scheduleDesc') },
    { term: t('access.kinds.block'), desc: t('access.kinds.blockDesc') },
  ];
  return (
    <Callout variant="info" standing title={t('access.kinds.title')} className={className}>
      <dl className="space-y-1">
        {kinds.map((k) => (
          <div key={k.term} className="flex flex-wrap gap-x-2">
            <dt className="font-medium text-kr-primary">{k.term}</dt>
            <dd className="min-w-0 flex-1 text-kr-secondary">{k.desc}</dd>
          </div>
        ))}
      </dl>
      <p className="text-kr-xs text-kr-muted">{t('access.kinds.note')}</p>
    </Callout>
  );
}
