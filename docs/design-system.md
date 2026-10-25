# KrakenOS — Sistema de diseño

Referente visual: **UniFi Network**. Filosofía: datos en tiempo real siempre visibles,
operaciones sin cambio de contexto, densidad de información sin sacrificar claridad.
El **tema oscuro es el default**; el tema claro sobreescribe los tokens.

Los tokens viven como **CSS custom properties** en `apps/web/src/index.css` (`:root`, `.dark` y
`html:not(.dark)`) y se exponen como utilidades de Tailwind **en el mismo fichero**, con `@theme`
(Tailwind 4: ya no hay `tailwind.config.ts`; el plugin `@tailwindcss/vite` lo compila). **Nunca**
hardcodear colores en componentes: usar siempre las utilidades `kr-*` / semánticas.

### Configuración de Tailwind 4 (`index.css`)

- **Entradas:** `@import 'tailwindcss' source(none)` + `@source` de `index.html` y de los
  `.ts`/`.tsx` de `src/`. Se acota a propósito: la detección automática barre también los tests,
  y un test que cite `text-yellow-500` metería esa clase en el CSS de producción.
- **Modo oscuro por clase:** `@custom-variant dark (&:where(.dark, .dark *))`. `<html class="dark">`
  es el default (ver `lib/theme.ts`).
- **Tema:** `@theme inline` mapea los `--kr-*` a nombres de utilidad, y los alias de shadcn
  (`--color-border`, `--color-primary`, `--color-input`, `--color-ring`…) apuntan a tokens `kr-*`:
  ya no hay canales HSL (`--border`, `--primary`) y un color nuevo no se define en dos sitios. `inline` emite `var(--kr-…)` tal cual, así que
  el cambio de tema lo resuelve el elemento y no `:root`. Los `--animate-kr-*` van en un `@theme`
  aparte (sus `@keyframes` están fuera de las capas).
- ⚠️ **Un color de `--color-*` genera las utilidades de TODAS las propiedades** (`bg-`, `text-`,
  `border-`, `ring-`, `outline-`, `divide-`…), a diferencia de la v3 (`backgroundColor`/`textColor`/
  `borderColor` por separado). Dos nombres significan cosas distintas según la propiedad y por eso
  son `@utility` a mano: `kr-muted` (texto = `--kr-text-muted`, borde = `--kr-border-muted`) y
  `kr-base` (fondo; como tamaño ya es `text-kr-base`). Un nombre nuevo que quiera valores
  distintos por propiedad va igual.
- **Preflight de la v4 neutralizado** en `@layer base`: cursor `pointer` de los botones no
  deshabilitados y color del placeholder (`#9ca3af`). El borde por defecto lo sigue fijando
  `* { @apply border-border }`.
- **Sin `tailwindcss-animate`:** su único uso era la entrada del slideover, ahora
  `animate-kr-slide-in-right`.
- **Renombres de la v4 que ya están aplicados:** `outline-none` → `outline-hidden`, `outline` →
  `outline-solid`, `rounded` → `rounded-sm` (4 px, con `--radius-sm`), `shadow` → `shadow-sm`.
  `rounded-sm` y `shadow-sm` **no** significan lo mismo que en la v3.

## Paleta — tokens CSS

| Token CSS | Valor (oscuro) | Valor (claro) | Uso |
|---|---|---|---|
| `--kr-bg-base` | `#0d1117` | `#f6f8fa` | Fondo principal |
| `--kr-bg-surface` | `#161b22` | `#ffffff` | Cards, paneles |
| `--kr-bg-elevated` | `#1c2230` | `#eef1f4` | Dropdowns, tooltips, sidebars |
| `--kr-border` | `rgba(255,255,255,0.08)` | `rgba(0,0,0,0.1)` | Bordes sutiles de tarjeta, tabla y sección |
| `--kr-border-muted` | `rgba(255,255,255,0.04)` | `rgba(0,0,0,0.06)` | Bordes casi invisibles |
| `--kr-border-field` | `#6e7176` | `#82868c` | Borde de campo (3:1 sobre surface y elevated) |
| `--kr-switch-off` | `#6e7176` | `#82868c` | Carril del interruptor apagado (3:1) |
| `--kr-ring` | `#0ea5e9` | `#0c8ec8` | Anillo de foco (3:1 sobre surface y elevated) |
| `--kr-text-primary` | `#e6edf3` | `#1f2328` | Texto principal |
| `--kr-text-secondary` | `#8b949e` | `#57606a` | Texto secundario |
| `--kr-text-muted` | `#868f9a` | `#5f6670` | Texto desactivado / metadata (AA) |
| `--kr-accent` | `#2563eb` | `#2563eb` | Azul de acción: fondo de botón, no texto |
| `--kr-accent-hover` | `#1d4ed8` | `#1d4ed8` | Hover de acción |
| `--kr-link` | `#58a6ff` | `#2563eb` | Enlaces y texto de acento |
| `--kr-success` | `#3fb950` | `#177031` | Éxito |
| `--kr-warning` | `#d29922` | `#855900` | Advertencia |
| `--kr-danger` | `#f9665f` | `#bb1f2a` | Error / peligro como texto |
| `--kr-danger-solid` | `#dc2626` | `#dc2626` | Fondo de botón destructivo (texto blanco, 4,83:1) |
| `--kr-online` | `#3fb950` | `#1a7f37` | Dot verde (online) |
| `--kr-offline` | `#666d76` | `#848b94` | Dot gris (offline) |

**Bordes:** un **campo** (`input`, `select`, `textarea`, interruptor) lleva `border-kr-field`
(3:1, WCAG 1.4.11); una **tarjeta o tabla** lleva `border-kr`, sutil a propósito. Un campo con
`border-kr` lo caza `test/lib/bordes-de-campo.test.ts`.

**Texto de acento:** `text-primary` y `text-destructive` son alias de fondo de botón y no valen
como texto (3,35:1 y 3,58:1 en oscuro): el texto usa `text-kr-link` y `text-danger`.

## Utilidades de Tailwind

**Fondos** (`bg-*`; `kr-base` no existe como color de texto para no chocar con la escala
tipográfica `text-kr-base`):
`bg-kr-base`, `bg-kr-surface`, `bg-kr-elevated`, `bg-kr-accent`, `bg-kr-accent-hover`,
`bg-success`, `bg-warning`, `bg-danger`, `bg-online`, `bg-offline`.

**Texto:** `text-kr-primary`, `text-kr-secondary`, `text-kr-muted`, `text-kr-link`,
`text-success`, `text-warning`, `text-danger`.

**Bordes:** `border-kr`, `border-kr-muted`, `border-kr-field` (+ `border-success`/`-warning`/`-danger`).

> Los colores semánticos (`success`/`warning`/`danger`/`online`/`offline`) y los `kr-*` de
> `--color-*` valen para cualquier propiedad de color (`ring-*`, `outline-*`, `divide-*`…) y
> admiten modificador de opacidad (`bg-warning/10`); `bg-kr-base`, `text-kr-muted` y
> `border-kr-muted` son utilidades estáticas y **no** lo admiten.

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
  `'online' | 'offline' | 'warning' | 'danger'`. Lleva **`role="img"`** + `aria-label`
  (etiqueta por defecto en español, sobreescribible con `label`). Usado en toda la app
  para estado de dispositivos, drivers e integraciones.
  > ⚠️ **`role="img"`, NO `role="status"`**: `status` es una *live region*, y 40
  > dispositivos en una tabla eran 40 regiones parloteando cada vez que una cambiaba. Un
  > indicador se anuncia cuando el usuario llega a él, no cuando cambia.
- **`Badge`** (`components/ui/badge.tsx`) — variantes `default`, `online`, `offline`,
  `warning`, `danger`. Superficie `bg-kr-elevated` + texto/borde semántico.
- **`Card`** (`components/ui/card.tsx`) — `rounded-xl border border-kr bg-kr-surface`,
  sin sombra (bordes muy sutiles, estilo UniFi).
- **`Button`** (`components/ui/button.tsx`) — variant `default` = `bg-kr-accent` +
  hover `bg-kr-accent-hover`; `outline`/`ghost` sobre `bg-kr-elevated`.
- **`LogoMark`** (`components/ui/logo.tsx`) — isotipo "Orbital" de marca (cabeza de kraken +
  nodos de red en simetría hexagonal), 100% geométrico. SVG inline con `currentColor`, así que
  el color se controla con `text-*` (normalmente `text-kr-accent`) y se adapta al tema. Decorativo
  (`aria-hidden`). Usado en sidebar, header móvil, login y setup. Fuente: `Icons/` (gitignored).

## Reglas

- Un único origen de color: los tokens `--kr-*`. No crear paletas nuevas por feature.
- El tema oscuro se aplica con la clase `dark` en `<html>` (ya en `index.html`).
- shadcn/ui se **adapta** a estos tokens, no se elimina.
