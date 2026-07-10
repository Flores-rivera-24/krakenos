import type { UserRole, UserSummary } from '@krakenos/types';
import { USER_ROLES } from '@krakenos/types';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingLine } from '@/components/ui/loading-line';
import { StatusDot } from '@/components/ui/status-dot';
import { describeError } from '@/lib/errors';
import { timeAgo } from '@/lib/format';
import { ROLE_LABELS } from '@/lib/roles';
import {
  createUser,
  deleteUser,
  listUsers,
  resetUserPassword,
  updateUser,
} from '@/lib/users';
import { useAuthStore } from '@/store/auth.store';
import { toast } from '@/store/toast.store';

const EMPTY_FORM = {
  email: '',
  displayName: '',
  password: '',
  role: 'viewer' as UserRole,
  /** Caducidad local (`datetime-local`) para invitados (US-179); '' = sin caducidad. */
  expiresAt: '',
};

/**
 * Gestión de usuarios (US-101) — alta, rol, estado, reset de contraseña y baja.
 * Solo se muestra a admins; el servidor impone la autorización de todos modos.
 */
export function UsersSection() {
  const currentId = useAuthStore((s) => s.user?.id);
  const [users, setUsers] = useState<UserSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetValue, setResetValue] = useState('');

  const load = async () => {
    setError(null);
    try {
      setUsers(await listUsers());
    } catch (err) {
      setError(describeError(err, 'No se pudieron cargar los usuarios'));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const submitNew = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const { expiresAt, ...base } = form;
      await createUser({
        ...base,
        // El invitado caduca (US-179): el input local se envía como ISO.
        ...(form.role === 'guest' && expiresAt !== ''
          ? { expiresAt: new Date(expiresAt).toISOString() }
          : {}),
      });
      toast.success(`Usuario ${form.email} creado`);
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      toast.error(describeError(err, 'No se pudo crear el usuario'));
    } finally {
      setCreating(false);
    }
  };

  const patch = async (id: string, body: Parameters<typeof updateUser>[1], okMsg: string) => {
    setBusyId(id);
    try {
      await updateUser(id, body);
      toast.success(okMsg);
      await load();
    } catch (err) {
      toast.error(describeError(err, 'No se pudo aplicar el cambio'));
      await load(); // revierte la UI a la verdad del servidor
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (u: UserSummary) => {
    if (!confirm(`¿Eliminar a ${u.email}? Esta acción no se puede deshacer.`)) return;
    setBusyId(u.id);
    try {
      await deleteUser(u.id);
      toast.success(`Usuario ${u.email} eliminado`);
      await load();
    } catch (err) {
      toast.error(describeError(err, 'No se pudo eliminar el usuario'));
    } finally {
      setBusyId(null);
    }
  };

  const submitReset = async (id: string) => {
    setBusyId(id);
    try {
      await resetUserPassword(id, { password: resetValue });
      toast.success('Contraseña restablecida (se cerraron sus sesiones)');
      setResetFor(null);
      setResetValue('');
    } catch (err) {
      toast.error(describeError(err, 'No se pudo restablecer la contraseña'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Alta de usuario */}
      <form
        onSubmit={submitNew}
        className="space-y-4 rounded-xl border border-kr bg-kr-surface p-5"
      >
        <div>
          <h3 className="text-kr-lg font-semibold text-kr-primary">Añadir usuario</h3>
          <p className="text-kr-sm text-kr-secondary">
            Da acceso a un familiar o a personal. «Solo lectura» ve el estado pero no cambia nada.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="nu-email">Email</Label>
            <Input
              id="nu-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
              maxLength={254}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nu-name">Nombre</Label>
            <Input
              id="nu-name"
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              required
              maxLength={80}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nu-pass">Contraseña inicial</Label>
            <Input
              id="nu-pass"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
              minLength={8}
              maxLength={128}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nu-role">Rol</Label>
            <select
              id="nu-role"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
              className="h-10 w-full rounded-md border border-kr bg-kr-elevated px-3 text-kr-base text-kr-primary"
            >
              {USER_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </div>
          {form.role === 'guest' && (
            <div className="space-y-1.5">
              <Label htmlFor="nu-expires">Caduca (invitado)</Label>
              <Input
                id="nu-expires"
                type="datetime-local"
                value={form.expiresAt}
                onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
              />
            </div>
          )}
        </div>
        <Button type="submit" disabled={creating}>
          {creating ? 'Creando…' : 'Crear usuario'}
        </Button>
      </form>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {/* Lista de usuarios */}
      {users === null ? (
        <LoadingLine label="Cargando usuarios…" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-kr">
          <table className="w-full text-kr-sm">
            <thead className="bg-kr-elevated text-kr-secondary">
              <tr>
                <th className="px-3 py-2 text-left">Usuario</th>
                <th className="px-3 py-2 text-left">Rol</th>
                <th className="px-3 py-2 text-left">Estado</th>
                <th className="px-3 py-2 text-left">Último acceso</th>
                <th className="px-3 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = u.id === currentId;
                const busy = busyId === u.id;
                return (
                  <tr key={u.id} className="border-t border-kr align-top">
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-kr-primary">
                        {u.displayName}
                        {isSelf && <span className="ml-1 text-kr-xs text-kr-muted">(tú)</span>}
                      </div>
                      <div className="text-kr-xs text-kr-muted">{u.email}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <select
                        aria-label={`Rol de ${u.email}`}
                        value={u.role}
                        disabled={busy}
                        onChange={(e) =>
                          void patch(u.id, { role: e.target.value as UserRole }, 'Rol actualizado')
                        }
                        className="h-8 rounded-md border border-kr bg-kr-elevated px-2 text-kr-sm text-kr-primary disabled:opacity-50"
                      >
                        {USER_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </option>
                        ))}
                      </select>
                      {u.expiresAt && (
                        <div className="mt-1 text-kr-xs text-kr-muted">
                          Caduca {new Date(u.expiresAt).toLocaleString()}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {u.status === 'active' ? (
                        <Badge variant="online">Activo</Badge>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-kr-secondary">
                          <StatusDot status="offline" /> Deshabilitado
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-kr-xs text-kr-muted">
                      {u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'Nunca'}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void patch(
                              u.id,
                              { status: u.status === 'active' ? 'disabled' : 'active' },
                              u.status === 'active' ? 'Usuario deshabilitado' : 'Usuario habilitado',
                            )
                          }
                        >
                          {u.status === 'active' ? 'Deshabilitar' : 'Habilitar'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => {
                            setResetFor(resetFor === u.id ? null : u.id);
                            setResetValue('');
                          }}
                        >
                          Contraseña
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={busy || isSelf}
                          title={isSelf ? 'No puedes eliminar tu propia cuenta' : undefined}
                          onClick={() => void remove(u)}
                        >
                          Eliminar
                        </Button>
                      </div>
                      {resetFor === u.id && (
                        <div className="mt-2 flex justify-end gap-2">
                          <Input
                            type="password"
                            aria-label={`Nueva contraseña de ${u.email}`}
                            placeholder="Nueva contraseña"
                            value={resetValue}
                            minLength={8}
                            maxLength={128}
                            onChange={(e) => setResetValue(e.target.value)}
                            className="h-8 max-w-[220px]"
                          />
                          <Button
                            size="sm"
                            disabled={busy || resetValue.length < 8}
                            onClick={() => void submitReset(u.id)}
                          >
                            Guardar
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
