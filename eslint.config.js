// Flat ESLint config shared across the monorepo.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      // Worktrees transitorios de agentes/editor (checkouts espejo; no son fuente a lintar).
      '**/.claude/**',
      '**/*.config.js',
      '**/prisma/**',
      // Assets estáticos servidos tal cual (script anti-flash de tema, sw.js, etc.).
      'apps/web/public/**',
      // Informes y artefactos que ESCRIBE Playwright al correr las suites: no son
      // fuente. Están gitignored, pero eslint tiene su propia lista y sin esto una
      // tanda local de `test:e2e:stacks` deja ~4.000 errores en el bundle minificado
      // del visor de trazas. Un gate que grita sin motivo se acaba silenciando.
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  // US-231 (AUD3-32): `scripts/**` estaba en `ignores`, así que el gate de
  // dependencias y el medidor de contraste —código que decide si CI pasa— no
  // pasaban por ningún lint. Ahora sí; solo hace falta declararles los globals de
  // Node, que no son ambiente por defecto en la config compartida.
  // US-231 (AUD3-32): ESLint usaba `recommended`, NO `recommendedTypeChecked`, así
  // que `no-floating-promises` —la regla que caza un `await` olvidado— no existía.
  // Evaluada sobre `apps/agent/src`: **cero infracciones**, así que se activa sin
  // deuda. Solo esa regla (no el preset típado entero) para no pagar el coste de
  // lint con tipos en todo el monorepo por reglas de estilo.
  {
    files: ['apps/agent/src/**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: { '@typescript-eslint/no-floating-promises': 'error' },
  },
  {
    files: ['**/scripts/**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        __dirname: 'readonly',
        fetch: 'readonly',
        // Temporizadores: los usa cualquier script que espere a un servicio
        // (p. ej. el arranque del agente en la prueba de carga). Sin declararlos,
        // `no-undef` los marca como error y el gate de lint se cae por un global
        // de Node perfectamente legítimo.
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
  },
);
