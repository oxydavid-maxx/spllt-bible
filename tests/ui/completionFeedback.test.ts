import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: (value: unknown) => value },
  Text: 'Text',
  View: 'View',
}));

import { buildCompletionFeedbackModel } from '../../src/ui/completionFeedback';

describe('completion feedback', () => {
  it('shows selected-date authoritative state separately from device pending state', () => {
    expect(buildCompletionFeedbackModel({ taskDate: '2026-09-09', status: 'COMPLETED', syncStatus: 'PENDING_SAVE', canUndo: true })).toEqual({
      label: '已保存 9月9日讀經，等待同步',
      showUndo: true,
      persistentUndo: true,
    });
  });
});
