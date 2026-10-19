import { expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ listener: null as ((state: string) => void) | null }));
vi.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: (_: string, fn: (state: string) => void) => { native.listener = fn; return { remove() {} }; } } }));
import { subscribeAppActive } from '../../src/services/appVisibility';
it('notifies once for a real foreground transition and ignores repeated active notifications', () => {
  const read = vi.fn(); const stop = subscribeAppActive(read);
  native.listener!('active'); expect(read).toHaveBeenCalledTimes(0);
  native.listener!('background'); native.listener!('active'); native.listener!('active');
  expect(read).toHaveBeenCalledTimes(1); stop();
});
