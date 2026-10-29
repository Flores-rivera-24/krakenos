import { Moon, Sun } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { toggleTheme, useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

interface Props {
  collapsed: boolean;
}

/** Muestra el icono del tema al que cambia: `Sun` en oscuro, `Moon` en claro. */
export function ThemeToggle({ collapsed }: Props) {
  const t = useT();
  const theme = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={() => toggleTheme()}
      aria-label={isDark ? t('theme.switchToLight') : t('theme.switchToDark')}
      title={isDark ? t('theme.switchToLight') : t('theme.switchToDark')}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-kr-secondary transition-colors hover:bg-kr-elevated hover:text-kr-primary',
        collapsed ? 'w-full justify-center px-0' : 'w-full',
      )}
    >
      {isDark ? <Sun className="h-5 w-5 shrink-0" /> : <Moon className="h-5 w-5 shrink-0" />}
      {!collapsed && (
        <span className="flex-1 truncate text-left text-kr-base">
          {isDark ? t('theme.light') : t('theme.dark')}
        </span>
      )}
    </button>
  );
}
