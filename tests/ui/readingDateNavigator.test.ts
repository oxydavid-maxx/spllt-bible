import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Pressable: 'Pressable', StyleSheet: { create: (value: unknown) => value }, Text: 'Text', View: 'View' }));
vi.mock('../../src/ui/Theme', () => ({ theme: {
  colors: { surface: '#fff', border: '#ddd', primary: '#123', muted: '#777' },
  control: { tap: 48, tapCompact: 40, hairline: 1 },
  radius: { button: 12, chip: 8 },
  spacing: { xs: 4, sm: 8 },
  type: { body: { size: 16 }, label: { size: 14 } },
} }));

describe('compact Reader selected-date header', () => {
  it('adds a stable Taipei weekday and a Today prefix only for the selected Taipei date', async () => {
    const module = await import('../../src/ui/ReadingDateNavigator');
    const format = (module as unknown as { formatReadingDateHeader?: (date: string, today: string) => string }).formatReadingDateHeader;
    expect(format).toBeTypeOf('function');
    expect(format!('2026-09-24', '2026-09-24')).toBe('今天·9/24（四）');
    expect(format!('2026-09-23', '2026-09-24')).toBe('9/23（三）');
  });
});
