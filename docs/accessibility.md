# Accesibilidad — KrakenOS

> Generado por `apps/web/scripts/check-contrast.mjs` a partir de los tokens kr-* de
> `apps/web/src/index.css`. Reejecuta el script tras tocar la paleta.

## Contraste WCAG 2.1 (US-95)

Umbrales AA: **4.5:1** texto normal · **3:1** texto grande / componentes. Ratios calculados
con la fórmula de luminancia relativa sRGB sobre los pares fondo/texto reales de la paleta.

### Tema oscuro (por defecto)

| Texto | Fondo | Ratio | Mínimo AA | Resultado |
| --- | --- | --- | --- | --- |
| `kr-text-primary` #e6edf3 | `kr-bg-base` #0d1117 | 16.02:1 | 4.5:1 | ✅ AA |
| `kr-text-secondary` #8b949e | `kr-bg-base` #0d1117 | 6.15:1 | 4.5:1 | ✅ AA |
| `kr-text-muted` #868f9a | `kr-bg-base` #0d1117 | 5.78:1 | 4.5:1 | ✅ AA |
| `kr-link` #58a6ff | `kr-bg-base` #0d1117 | 7.49:1 | 4.5:1 | ✅ AA |
| `kr-text-primary` #e6edf3 | `kr-bg-surface` #161b22 | 14.64:1 | 4.5:1 | ✅ AA |
| `kr-text-secondary` #8b949e | `kr-bg-surface` #161b22 | 5.62:1 | 4.5:1 | ✅ AA |
| `kr-text-muted` #868f9a | `kr-bg-surface` #161b22 | 5.28:1 | 4.5:1 | ✅ AA |
| `kr-link` #58a6ff | `kr-bg-surface` #161b22 | 6.85:1 | 4.5:1 | ✅ AA |
| `kr-text-primary` #e6edf3 | `kr-bg-elevated` #1c2230 | 13.46:1 | 4.5:1 | ✅ AA |
| `kr-text-secondary` #8b949e | `kr-bg-elevated` #1c2230 | 5.17:1 | 4.5:1 | ✅ AA |
| `kr-text-muted` #868f9a | `kr-bg-elevated` #1c2230 | 4.85:1 | 4.5:1 | ✅ AA |
| `kr-link` #58a6ff | `kr-bg-elevated` #1c2230 | 6.29:1 | 4.5:1 | ✅ AA |
| `kr-success` #3fb950 | `kr-bg-surface` #161b22 | 6.81:1 | 4.5:1 | ✅ AA |
| `kr-info` #0ea5e9 | `kr-bg-surface` #161b22 | 6.24:1 | 4.5:1 | ✅ AA |
| `kr-warning` #d29922 | `kr-bg-surface` #161b22 | 6.85:1 | 4.5:1 | ✅ AA |
| `kr-danger` #f85149 | `kr-bg-surface` #161b22 | 5.16:1 | 4.5:1 | ✅ AA |
| `kr-accent` #2563eb | `kr-bg-surface` #161b22 | 3.35:1 | 3:1 | ✅ AA |
| `white` #ffffff | `kr-accent` #2563eb | 5.17:1 | 4.5:1 | ✅ AA |

### Tema claro

| Texto | Fondo | Ratio | Mínimo AA | Resultado |
| --- | --- | --- | --- | --- |
| `kr-text-primary` #1f2328 | `kr-bg-base` #f6f8fa | 14.84:1 | 4.5:1 | ✅ AA |
| `kr-text-secondary` #57606a | `kr-bg-base` #f6f8fa | 6.00:1 | 4.5:1 | ✅ AA |
| `kr-text-muted` #5f6670 | `kr-bg-base` #f6f8fa | 5.45:1 | 4.5:1 | ✅ AA |
| `kr-link` #2563eb | `kr-bg-base` #f6f8fa | 4.85:1 | 4.5:1 | ✅ AA |
| `kr-text-primary` #1f2328 | `kr-bg-surface` #ffffff | 15.80:1 | 4.5:1 | ✅ AA |
| `kr-text-secondary` #57606a | `kr-bg-surface` #ffffff | 6.39:1 | 4.5:1 | ✅ AA |
| `kr-text-muted` #5f6670 | `kr-bg-surface` #ffffff | 5.80:1 | 4.5:1 | ✅ AA |
| `kr-link` #2563eb | `kr-bg-surface` #ffffff | 5.17:1 | 4.5:1 | ✅ AA |
| `kr-text-primary` #1f2328 | `kr-bg-elevated` #eef1f4 | 13.93:1 | 4.5:1 | ✅ AA |
| `kr-text-secondary` #57606a | `kr-bg-elevated` #eef1f4 | 5.64:1 | 4.5:1 | ✅ AA |
| `kr-text-muted` #5f6670 | `kr-bg-elevated` #eef1f4 | 5.12:1 | 4.5:1 | ✅ AA |
| `kr-link` #2563eb | `kr-bg-elevated` #eef1f4 | 4.56:1 | 4.5:1 | ✅ AA |
| `kr-success` #1a7f37 | `kr-bg-surface` #ffffff | 5.08:1 | 4.5:1 | ✅ AA |
| `kr-info` #0969da | `kr-bg-surface` #ffffff | 5.19:1 | 4.5:1 | ✅ AA |
| `kr-warning` #9a6700 | `kr-bg-surface` #ffffff | 4.87:1 | 4.5:1 | ✅ AA |
| `kr-danger` #cf222e | `kr-bg-surface` #ffffff | 5.36:1 | 4.5:1 | ✅ AA |
| `kr-accent` #2563eb | `kr-bg-surface` #ffffff | 5.17:1 | 3:1 | ✅ AA |
| `white` #ffffff | `kr-accent` #2563eb | 5.17:1 | 4.5:1 | ✅ AA |


## Cobertura por herramienta (axe-core)

`test/a11y/pages.a11y.test.tsx` monta cada página y exige **cero violaciones** de las reglas
WCAG 2.0/2.1 A y AA de axe-core (nombres accesibles de controles, roles, labels de formulario,
etc.). El contraste de color no se puede medir en jsdom (sin layout real), por eso se calcula
aparte con este script. Cubre el trabajo previo de US-62 (labels de iconos/formularios, captions
y `scope` en tablas, `aria-sort`, focus-trap en Slideover/Dialog) sin rehacerlo.

_Última verificación: todos los pares cumplen AA._
