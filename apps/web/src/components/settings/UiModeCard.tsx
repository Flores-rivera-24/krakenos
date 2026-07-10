import type { UiMode, User } from '@krakenos/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { describeError } from '@/lib/errors';
import { useAuthStore } from '@/store/auth.store';
import { toast } from '@/store/toast.store';
import { useState } from 'react';

const OPTIONS: { mode: UiMode; label: string; description: string }[] = [
  {
    mode: 'simple',
    label: 'Sencillo',
    description: 'Solo lo cotidiano: dispositivos, hogar, WiFi y cámaras. Sin jerga técnica.',
  },
  {
    mode: 'advanced',
    label: 'Avanzado',
    description: 'Todo, incluida la red avanzada (VPN, firewall, VLANs, QoS, DNS).',
  },
];

/**
 * Modo de la interfaz (US-176): preferencia por usuario, autoservicio. Solo
 * presentación — los permisos los impone el servidor en cada ruta.
 */
export function UiModeCard() {
  const user = useAuthStore((s) => s.user);
  const [saving, setSaving] = useState(false);
  const current: UiMode = user?.uiMode === 'simple' ? 'simple' : 'advanced';

  const change = async (mode: UiMode) => {
    if (mode === current || saving) return;
    setSaving(true);
    try {
      const updated = await api.patch<User>('/auth/ui-mode', { uiMode: mode });
      useAuthStore.setState({ user: updated });
      toast.success(mode === 'simple' ? 'Modo sencillo activado' : 'Modo avanzado activado');
    } catch (err) {
      toast.error(describeError(err, 'No se pudo cambiar el modo'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Modo de la aplicación</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Modo de la aplicación">
          {OPTIONS.map((opt) => (
            <button
              key={opt.mode}
              type="button"
              aria-pressed={current === opt.mode}
              disabled={saving}
              onClick={() => void change(opt.mode)}
              className={cn(
                'rounded-lg border p-3 text-left transition-colors',
                current === opt.mode
                  ? 'border-kr-accent bg-kr-accent-faint'
                  : 'border-kr bg-kr-elevated hover:border-kr-accent-glow',
              )}
            >
              <span className="block font-medium text-kr-primary">{opt.label}</span>
              <span className="block text-kr-xs text-kr-muted">{opt.description}</span>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
