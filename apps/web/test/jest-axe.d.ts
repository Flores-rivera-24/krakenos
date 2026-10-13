// `@types/jest-axe` solo aumenta el espacio `jest` (y `@jest/expect`), que
// Vitest 5 ya no mezcla en su `Assertion`: sin esto `toHaveNoViolations` no
// existe para el compilador, aunque `expect.extend(toHaveNoViolations)` lo
// registre en runtime.
import 'vitest';

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  interface Assertion<T = any> {
    toHaveNoViolations(): void;
  }
  interface AsymmetricMatchersContaining {
    toHaveNoViolations(): void;
  }
}
