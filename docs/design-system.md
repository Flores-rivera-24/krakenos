# KrakenOS — Sistema de diseño (US-33)

Referente visual: **UniFi Network**. Filosofía: datos en tiempo real siempre visibles,
operaciones sin cambio de contexto, densidad de información sin sacrificar claridad.
El **tema oscuro es el default**; el tema claro (US-41) sobreescribe los tokens.

Los tokens viven como **CSS custom properties** en `apps/web/src/index.css` (`:root` y `.dark`)
y se exponen como utilidades de Tailwind en `apps/web/tailwind.config.ts`. **Nunca** hardcodear
colores en componentes: usar siempre las utilidades `kr-*` / semánticas.

## Paleta — tokens CSS

| Token CSS | Valor (oscuro) | Uso |
|---|---|---|
| `--kr-bg-base` | `#0d1117` | Fondo principal (casi negro azulado) |
| `--kr-bg-surface` | `#161b22` | Cards, paneles |
| `--kr-bg-elevated` | `#1c2230` | Dropdowns, tooltips, sidebars |
| `--kr-border` | `rgba(255,255,255,0.08)` | Bordes sutiles |
| `--kr-border-muted` | `rgba(255,255,255,0.04)` | Bordes casi invisibles |
| `--kr-text-primary` | `#e6edf3` | Texto principal |
| `--kr-text-secondary` | `#8b949e` | Texto secundario |
| `--kr-text-muted` | `#484f58` | Texto desactivado / metadata |
| `--kr-accent` | `#2563eb` | Azul de acción (mismo que UniFi) |
| `--kr-accent-hover` | `#1d4ed8` | Hover de acción |
| `--kr-success` | `#3fb950` | Éxito |
| `--kr-warning` | `#d29922` | Advertencia |
| `--kr-danger` | `#f85149` | Error / peligro |
| `--kr-online` | `#3fb950` | Dot verde (online) |
| `--kr-offline` | `#484f58` | Dot gris (offline) |

## Utilidades de Tailwind

**Fondos** (solo `bg-*`, para no colisionar con la escala tipográfica `text-kr-*`):
`bg-kr-base`, `bg-kr-surface`, `bg-kr-elevated`, `bg-kr-accent`, `bg-kr-accent-hover`,
`bg-success`, `bg-warning`, `bg-danger`, `bg-online`, `bg-offline`.

**Texto:** `text-kr-primary`, `text-kr-secondary`, `text-kr-muted`, `text-kr-accent`,
`text-success`, `text-warning`, `text-danger`.

**Bordes:** `border-kr`, `border-kr-muted` (+ `border-success`/`-warning`/`-danger` vía `colors`).

> Los colores semánticos (`success`/`warning`/`danger`/`online`/`offline`) están en `colors`,
> así que también se pueden usar como `ring-*`, `border-*`, etc.

## Tipografía

Fuente principal **Inter** (importada en `index.css`, configurada como `font-sans`).
Escala utilitaria (`text-kr-*`):

| Clase | Tamaño / interlineado | Uso |
|---|---|---|
| `text-kr-xs` | 11px / 16px | Metadata, timestamps |
| `text-kr-sm` | 13px / 18px | Labels, badges, secondary |
| `text-kr-base` | 14px / 20px | Cuerpo de texto |
| `text-kr-lg` | 16px / 24px | Subtítulos de sección |
| `text-kr-xl` | 20px / 28px | Títulos de página |
| `text-kr-2xl` | 24px / 32px | Números grandes en dashboard |

## Componentes base

- **`StatusDot`** (`components/ui/status-dot.tsx`) — punto de 8px con `status`
  `'online' | 'offline' | 'warning' | 'danger'`. Lleva `role="status"` + `aria-label`
  (etiqueta por defecto en español, sobreescribible con `label`). Usado en toda la app
  para estado de dispositivos, drivers e integraciones.
- **`Badge`** (`components/ui/badge.tsx`) — variantes `default`, `online`, `offline`,
  `warning`, `danger`. Superficie `bg-kr-elevated` + texto/borde semántico.
- **`Card`** (`components/ui/card.tsx`) — `rounded-xl border border-kr bg-kr-surface`,
  sin sombra (bordes muy sutiles, estilo UniFi).
- **`Button`** (`components/ui/button.tsx`) — variant `default` = `bg-kr-accent` +
  hover `bg-kr-accent-hover`; `outline`/`ghost` sobre `bg-kr-elevated`.

## Reglas

- Un único origen de color: los tokens `--kr-*`. No crear paletas nuevas por feature.
- El tema oscuro se aplica con la clase `dark` en `<html>` (ya en `index.html`).
- shadcn/ui se **adapta** a estos tokens, no se elimina.
