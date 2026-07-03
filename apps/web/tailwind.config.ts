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
        // Texto de acento accesible (enlaces/nav activa) sobre fondos oscuros (US-95).
        'kr-link': 'var(--kr-link)',
        success: 'var(--kr-success)',
        info: 'var(--kr-info)',
        warning: 'var(--kr-warning)',
        danger: 'var(--kr-danger)',
      },
      // Bordes sutiles: border-kr y border-kr-muted (+ acento y su halo, US-160).
      borderColor: {
        kr: 'var(--kr-border)',
        'kr-muted': 'var(--kr-border-muted)',
        'kr-elevated': 'var(--kr-bg-elevated)',
        'kr-accent': 'var(--kr-accent)',
        'kr-accent-glow': 'var(--kr-accent-glow)',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      // Halos de acento para superficies "tecnológicas" (US-160).
      boxShadow: {
        'kr-glow': '0 0 0 1px var(--kr-accent-glow), 0 0 24px -6px var(--kr-accent-glow)',
        'kr-glow-sm': '0 0 16px -8px var(--kr-accent-glow)',
      },
      // Lenguaje de movimiento del sistema (US-160). Todo respeta
      // prefers-reduced-motion vía las variantes motion-reduce:* donde aplica.
      keyframes: {
        'kr-shimmer': {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        'kr-fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'kr-fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'kr-orbit': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        'kr-pulse-ring': {
          '0%': { transform: 'scale(0.7)', opacity: '0.55' },
          '70%': { opacity: '0' },
          '100%': { transform: 'scale(1.7)', opacity: '0' },
        },
        'kr-glow': {
          '0%, 100%': { opacity: '0.55' },
          '50%': { opacity: '1' },
        },
      },
      animation: {
        'kr-shimmer': 'kr-shimmer 1.6s ease-in-out infinite',
        'kr-fade-up': 'kr-fade-up 0.4s ease-out both',
        'kr-fade-in': 'kr-fade-in 0.3s ease-out both',
        'kr-orbit': 'kr-orbit 3.2s linear infinite',
        'kr-orbit-slow': 'kr-orbit 9s linear infinite',
        'kr-pulse-ring': 'kr-pulse-ring 2.2s ease-out infinite',
        'kr-glow': 'kr-glow 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [animate],
};

export default config;
