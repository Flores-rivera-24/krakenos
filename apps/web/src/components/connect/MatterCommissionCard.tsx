import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiRequestError } from '@/lib/api';
import { useT, type TranslationKey } from '@/lib/i18n';
import { commissionMatter } from '@/lib/matter-bridge';

/** Código de error del comisionado → clave i18n del mensaje amable (US-172). */
const ERROR_KEY: Record<string, TranslationKey> = {
  'invalid-code': 'matter.commission.err.invalidCode',
  'not-found': 'matter.commission.err.notFound',
  'thread-no-border': 'matter.commission.err.threadNoBorder',
  MATTER_UNAVAILABLE: 'matter.commission.err.unavailable',
  failed: 'matter.commission.err.failed',
};

/**
 * «Añadir dispositivo Matter» (US-172): el usuario pega el QR o el código de
 * emparejamiento y KrakenOS lo comisiona vía python-matter-server. Los errores se
 * traducen a un mensaje claro (código inválido, dispositivo lejos, Thread sin
 * border router…). Solo admin (el servidor lo impone igualmente).
 */
export function MatterCommissionCard() {
  const t = useT();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setOk(null);
    setError(null);
    try {
      const result = await commissionMatter(code.trim());
      setOk(t('matter.commission.ok', { name: result.name }));
      setCode('');
    } catch (err) {
      const errCode = err instanceof ApiRequestError ? err.body?.code : undefined;
      setError(t(ERROR_KEY[errCode ?? 'failed'] ?? 'matter.commission.err.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-kr-lg font-semibold text-kr-primary">{t('matter.commission.title')}</h2>
        <p className="text-kr-sm text-kr-muted">{t('matter.commission.subtitle')}</p>
      </div>
      <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={t('matter.commission.placeholder')}
          aria-label={t('matter.commission.title')}
          className="max-w-xs flex-1"
        />
        <Button type="submit" disabled={busy || !code.trim()}>
          {t('matter.commission.add')}
        </Button>
      </form>
      {ok && (
        <p role="status" className="text-kr-sm text-kr-success">
          {ok}
        </p>
      )}
      {error && (
        <p role="alert" className="text-kr-sm text-kr-danger">
          {error}
        </p>
      )}
    </section>
  );
}
