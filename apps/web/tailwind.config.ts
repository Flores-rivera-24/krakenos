import animate from 'tailwindcss-animate';
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      // Escala tipográfica del sistema de diseño (US-33). [size, lineHeight]
      fontSize: {
        'kr-xs': ['11px', '16px'], // metadata, timestamps
        'kr-sm': ['13px', '18px'], // labels, badges, secondary
        'kr-base': ['14px', '20px'], // cuerpo de texto
        'kr-lg': ['16px', '24px'], // subtítulos de sección
        'kr-xl': ['20px', '28px'], // títulos de página
        'kr-2xl': ['24px', '32px'], // números grandes en dashboard
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Colores semánticos KrakenOS — usables también como text-/border-/ring-.
        success: 'var(--kr-success)',
        info: 'var(--kr-info)',
        warning: 'var(--kr-warning)',
        danger: 'var(--kr-danger)',
        online: 'var(--kr-online)',
        offline: 'var(--kr-offline)',
      },
      // Fondos del sistema de diseño: solo bg-* (no colisionan con la escala text-kr-*).
      backgroundColor: {
        'kr-base': 'var(--kr-bg-base)',
        'kr-surface': 'var(--kr-bg-surface)',
        'kr-elevated': 'var(--kr-bg-elevated)',
        'kr-accent': 'var(--kr-accent)',
        'kr-accent-hover': 'var(--kr-accent-hover)',
        success: 'var(--kr-success)',
        info: 'var(--kr-info)',
        warning: 'var(--kr-warning)',
        danger: 'var(--kr-danger)',
        online: 'var(--kr-online)',
        offline: 'var(--kr-offline)',
      },
      // Texto del sistema de diseño.
      textColor: {
        'kr-primary': 'var(--kr-text-primary)',
        'kr-secondary': 'var(--kr-text-secondary)',
        'kr-muted': 'var(--kr-text-muted)',
        'kr-accent': 'var(--kr-accent)',
        success: 'var(--kr-success)',
        info: 'var(--kr-info)',
        warning: 'var(--kr-warning)',
        danger: 'var(--kr-danger)',
      },
      // Bordes sutiles: border-kr y border-kr-muted.
      borderColor: {
        kr: 'var(--kr-border)',
        'kr-muted': 'var(--kr-border-muted)',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [animate],
};

export default config;
