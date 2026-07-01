import { ArrowRight, CheckCircle2, Circle, Rocket, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getIntegrations } from '@/lib/integrations';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';

const DISMISS_KEY = 'krakenos-onboarding-dismissed';

interface Step {
  id: string;
  label: string;
  description: string;
  to: string;
  done: boolean;
}

/**
 * Tarjeta de "primeros pasos" (US-145) para el primer arranque: guía a un usuario
 * nuevo a conectar sus dispositivos. Marca como hechos los pasos ya configurados
 * (según `/api/integrations`), se descarta a mano y desaparece sola cuando lo esencial
 * (red + un IoT) ya está conectado. Solo para administradores (quien da de alta equipos).
 */
export function GettingStarted() {
  const role = useAuthStore((s) => s.user?.role);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [routerDone, setRouterDone] = useState(false);
  const [iotDone, setIotDone] = useState(false);

  useEffect(() => {
    let active = true;
    getIntegrations()
      .then((domains) => {
        if (!active) return;
        setRouterDone(domains.find((d) => d.domain === 'driver')?.source === 'db');
        setIotDone(domains.find((d) => d.domain === 'iot')?.source === 'db');
      })
      .catch(() => undefined); // sin datos: se muestran los pasos sin marcar
    return () => {
      active = false;
    };
  }, []);

  // Solo el administrador conecta equipos; y no molestamos si ya está descartada o
  // si lo esencial (red + un dispositivo IoT) ya está conectado.
  if (role !== 'admin' || dismissed || (routerDone && iotDone)) return null;

  const dismiss = (): void => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  const steps: Step[] = [
    {
      id: 'router',
      label: 'Conecta tu red',
      description: 'Tu router o punto de acceso, para ver y controlar tus dispositivos.',
      to: '/connect',
      done: routerDone,
    },
    {
      id: 'iot',
      label: 'Añade una luz o un enchufe',
      description: 'Philips Hue, Govee, TP-Link, Shelly y más — con guía paso a paso.',
      to: '/connect',
      done: iotDone,
    },
    {
      id: 'wifi',
      label: 'Revisa tu WiFi',
      description: 'Nombre de red, contraseña y red de invitados.',
      to: '/wifi',
      done: false,
    },
    {
      id: 'camera',
      label: 'Añade una cámara',
      description: 'Mira tus cámaras IP dentro de la app.',
      to: '/cameras',
      done: false,
    },
  ];

  return (
    <section
      aria-labelledby="onboarding-title"
      className="rounded-xl border border-kr bg-kr-surface p-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-kr-elevated text-kr-accent">
            <Rocket className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h3 id="onboarding-title" className="text-kr-lg font-semibold text-kr-primary">
              ¡Bienvenido a KrakenOS!
            </h3>
            <p className="text-kr-sm text-kr-secondary">
              Conecta tus dispositivos en unos minutos. Te guiamos en cada paso.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Descartar primeros pasos"
          className="rounded p-1 text-kr-secondary hover:bg-kr-elevated hover:text-kr-primary"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {steps.map((step) => (
          <li key={step.id}>
            <Link
              to={step.to}
              className={cn(
                'flex items-start gap-3 rounded-lg border border-kr p-3 transition-colors hover:bg-kr-elevated',
                step.done && 'opacity-70',
              )}
            >
              {step.done ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
              ) : (
                <Circle className="mt-0.5 h-5 w-5 shrink-0 text-kr-secondary" aria-hidden />
              )}
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-kr-base font-medium text-kr-primary">
                  {step.label}
                  {step.done && <span className="text-kr-xs text-success">· hecho</span>}
                </span>
                <span className="block text-kr-sm text-kr-secondary">{step.description}</span>
              </span>
              {!step.done && (
                <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-kr-secondary" aria-hidden />
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
