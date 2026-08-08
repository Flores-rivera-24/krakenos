import type { AccessRequest, Invitation, UserRole } from '@krakenos/types';
import { USER_ROLES } from '@krakenos/types';
import { Check, Copy, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingLine } from '@/components/ui/loading-line';
import { RichText } from '@/components/ui/rich-text';
import { describeError } from '@/lib/errors';
import { useT, type TranslationKey } from '@/lib/i18n';
import { timeAgo } from '@/lib/format';
import { ROLE_LABELS } from '@/lib/roles';
import {
  createInvitation,
  decideAccessRequest,
  listAccessRequests,
  listInvitations,
  revokeInvitation,
} from '@/lib/onboarding';
import { toast } from '@/store/toast.store';

const EMPTY = { email: '', displayName: '', role: 'member' as UserRole };

/**
 * Guarda la **clave**, no el texto: una constante de modulo con el copy ya
 * traducido se congela con el idioma que hubiera al importarlo.
 */
const STATUS_KEY: Record<Invitation['status'], TranslationKey> = {
  pending: 'invitations.status.pending',
  used: 'invitations.status.used',
  expired: 'invitations.status.expired',
};

/**
 * Invitaciones y solicitudes de acceso (US-272 / US-273). Admin-only; el servidor
 * impone la autorización de todos modos.
 *
 * Sustituye al alta en la que el admin tecleaba él la contraseña y se la mandaba a
 * la persona por un chat. Aquí nunca se escribe la contraseña de nadie: se comparte
 * un enlace y la elige quien la va a usar.
 */
export function InvitationsCard() {
  const t = useT();
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [requests, setRequests] = useState<AccessRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  /**
   * El enlace recién emitido. Se guarda en memoria porque el servidor **no puede
   * volver a enseñarlo**: solo almacena su hash. Si se pierde, se emite otro.
   */
  const [freshLink, setFreshLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [roleFor, setRoleFor] = useState<Record<string, UserRole>>({});

  const load = async () => {
    try {
      const [inv, reqs] = await Promise.all([listInvitations(), listAccessRequests('pending')]);
      setInvitations(inv);
      setRequests(reqs);
      setError(null);
    } catch (err) {
      setError(describeError(err, t('invitations.loadError')));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await createInvitation(form);
      setFreshLink(`${window.location.origin}${res.path}`);
      setCopied(false);
      setForm(EMPTY);
      toast.success(t('invitations.created', { email: res.invitation.email }));
      await load();
    } catch (err) {
      toast.error(describeError(err, t('invitations.createError')));
    } finally {
      setCreating(false);
    }
  };

  const onRevoke = async (inv: Invitation) => {
    setBusyId(inv.id);
    try {
      await revokeInvitation(inv.id);
      toast.success(t('invitations.revoked'));
      await load();
    } catch (err) {
      toast.error(describeError(err, t('invitations.revokeError')));
    } finally {
      setBusyId(null);
    }
  };

  const onDecide = async (req: AccessRequest, decision: 'approve' | 'reject') => {
    setBusyId(req.id);
    try {
      const res = await decideAccessRequest(req.id, {
        decision,
        ...(decision === 'approve' ? { role: roleFor[req.id] ?? 'member' } : {}),
      });
      if (res.invitation) {
        setFreshLink(`${window.location.origin}${res.invitation.path}`);
        setCopied(false);
        toast.success(t('invitations.approved', { name: req.displayName }));
      } else {
        toast.success(t('requests.rejected'));
      }
      await load();
    } catch (err) {
      toast.error(describeError(err, t('requests.decideError')));
    } finally {
      setBusyId(null);
    }
  };

  const copy = async () => {
    if (!freshLink) return;
    try {
      await navigator.clipboard.writeText(freshLink);
      setCopied(true);
    } catch {
      // Sin permiso de portapapeles el enlace sigue visible y seleccionable: no se
      // pierde nada, así que no merece un error a pantalla completa.
      toast.error(t('invitations.copyError'));
    }
  };

  return (
    <div className="space-y-6">
      {error && <ErrorBanner>{error}</ErrorBanner>}

      {/* --- Solicitudes pendientes: lo primero, porque hay alguien esperando --- */}
      {requests !== null && requests.length > 0 && (
        <section className="rounded-xl border border-kr bg-kr-surface p-4">
          <h3 className="text-kr-lg font-medium text-kr-primary">{t('requests.title')}</h3>
          <p className="mt-1 text-kr-sm text-kr-secondary">{t('requests.hint')}</p>
          <ul className="mt-3 space-y-2">
            {requests.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-kr-muted bg-kr-base p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-kr-base text-kr-primary">{r.displayName}</p>
                  <p className="truncate text-kr-xs text-kr-secondary">
                    {r.email} · {timeAgo(r.createdAt)}
                  </p>
                  {r.note && <p className="mt-1 text-kr-xs text-kr-muted">«{r.note}»</p>}
                </div>
                <select
                  aria-label={t('requests.roleFor', { name: r.displayName })}
                  value={roleFor[r.id] ?? 'member'}
                  onChange={(e) => setRoleFor((m) => ({ ...m, [r.id]: e.target.value as UserRole }))}
                  className="rounded-lg border border-kr bg-kr-elevated px-2 py-1.5 text-kr-sm text-kr-primary"
                >
                  {USER_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  onClick={() => void onDecide(r, 'approve')}
                  disabled={busyId === r.id}
                >
                  {t('requests.approve')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void onDecide(r, 'reject')}
                  disabled={busyId === r.id}
                >
                  {t('requests.reject')}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* --- Enlace recién emitido --- */}
      {freshLink && (
        <section className="rounded-xl border border-kr-accent bg-kr-elevated p-4">
          <h3 className="text-kr-base font-medium text-kr-primary">{t('invitations.freshTitle')}</h3>
          <p className="mt-1 text-kr-sm text-kr-secondary">
            <RichText>{t('invitations.freshBody')}</RichText>
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-kr bg-kr-base px-3 py-2 text-kr-xs text-kr-primary">
              {freshLink}
            </code>
            <Button type="button" variant="outline" onClick={() => void copy()}>
              {copied ? <Check size={15} /> : <Copy size={15} />}
              <span className="ml-1.5">{copied ? t('common.copied') : t('common.copy')}</span>
            </Button>
            <Button type="button" variant="ghost" onClick={() => setFreshLink(null)}>
              <X size={15} />
            </Button>
          </div>
        </section>
      )}

      {/* --- Invitar --- */}
      <section className="rounded-xl border border-kr bg-kr-surface p-4">
        <h3 className="text-kr-lg font-medium text-kr-primary">{t('invitations.inviteTitle')}</h3>
        <p className="mt-1 text-kr-sm text-kr-secondary">{t('invitations.inviteHint')}</p>
        <form onSubmit={(e) => void onCreate(e)} className="mt-3 grid gap-3 sm:grid-cols-4">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="inv-email">{t('invitations.email')}</Label>
            <Input
              id="inv-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-name">{t('users.name')}</Label>
            <Input
              id="inv-name"
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              required
              maxLength={80}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-role">{t('users.col.role')}</Label>
            <select
              id="inv-role"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
              className="h-9 w-full rounded-lg border border-kr bg-kr-elevated px-2 text-kr-sm text-kr-primary"
            >
              {USER_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-4">
            <Button type="submit" disabled={creating}>
              {creating ? t('users.creating') : t('invitations.create')}
            </Button>
          </div>
        </form>
      </section>

      {/* --- Invitaciones emitidas --- */}
      <section className="rounded-xl border border-kr bg-kr-surface p-4">
        <h3 className="text-kr-lg font-medium text-kr-primary">{t('invitations.title')}</h3>
        {invitations === null ? (
          <LoadingLine />
        ) : invitations.length === 0 ? (
          <p className="mt-2 text-kr-sm text-kr-secondary">{t('invitations.empty')}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {invitations.map((inv) => (
              <li
                key={inv.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-kr-muted bg-kr-base p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-kr-base text-kr-primary">{inv.email}</p>
                  <p className="truncate text-kr-xs text-kr-secondary">
                    {t('invitations.meta', {
                      role: ROLE_LABELS[inv.role],
                      estado:
                        inv.status === 'used'
                          ? t('invitations.usedAgo', {
                              when: timeAgo(inv.usedAt ?? inv.createdAt),
                            })
                          : t('invitations.expiresAgo', { when: timeAgo(inv.expiresAt) }),
                    })}
                  </p>
                </div>
                <Badge variant={inv.status === 'pending' ? 'online' : 'offline'}>
                  {t(STATUS_KEY[inv.status])}
                </Badge>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void onRevoke(inv)}
                  disabled={busyId === inv.id}
                >
                  {inv.status === 'pending' ? t('invitations.revoke') : t('invitations.remove')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
