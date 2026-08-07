import { stopStacks } from './lib/stacks.js';

/** Detiene los dos stacks al terminar la tanda. */
export default function globalTeardown(): void {
  stopStacks();
}
