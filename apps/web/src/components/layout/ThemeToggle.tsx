import { Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { getTheme, toggleTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

interface Props {
  collapsed: boolean;
}

/**
 * Botón para alternar tema claro/oscuro desde la sidebar (US-44). Reutiliza `lib/theme.ts`.
 * En modo oscuro muestra `Sun` ("cambiar a claro"); en claro, `Moon` ("cambiar a oscuro").
 */
export function ThemeToggle({ collapsed }: Props) {
  const [theme, setTheme] = useState(getTheme());
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={() => setTheme(toggleTheme())}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-kr-secondary transition-colors hover:bg-kr-elevated hover:text-kr-primary',
        collapsed ? 'w-full justify-center px-0' : 'w-full',
      )}
    >
      {isDark ? <Sun className="h-5 w-5 shrink-0" /> : <Moon className="h-5 w-5 shrink-0" />}
      {!collapsed && (
        <span className="flex-1 truncate text-left text-kr-base">
          {isDark ? 'Light mode' : 'Dark mode'}
        </span>
      )}
    </button>
  );
}
