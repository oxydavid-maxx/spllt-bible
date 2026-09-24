import { describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({ StyleSheet: { create: (value: unknown) => value } }));
import { buildCompletionAwardMessage } from '../../src/ui/CompletionAwardFeedback';
import type { CompletionAwardEvent } from '../../src/services/completionController';

const award: CompletionAwardEvent = {
  memberId: 'member-1', planId: 'church-2026-09', taskDate: '2026-09-12',
  operationId: 'completion-op', pointsDelta: 2, earnedTotal: 14, redeemableBalance: 9,
};

describe('completion award feedback', () => {
  it('uses the operation date after Reader changes the selected date', () => {
    expect(buildCompletionAwardMessage(award, '2026-09-14')).toBe('+2 分　完成9月12日讀經了！');
  });

  it('uses the today label only when the operation itself is for Taipei today', () => {
    expect(buildCompletionAwardMessage({ ...award, taskDate: '2026-09-14' }, '2026-09-14')).toBe('+2 分　完成今日讀經了！');
  });
});
