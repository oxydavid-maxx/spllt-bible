import { describe, expect, it } from 'vitest';
import { describeDeadline } from '../../src/domain/nominationRound';

const at = (iso: string) => Date.parse(iso);
const CLOSES = at('2026-09-30T16:00:00.000Z');

describe('how long is left to vote', () => {
  // 光佑 2026-09-27: 「還有 9 天」 did not say what the nine days were for, or which day ends them.
  it('counts the voting days and names the last day, in Taipei', () => {
    expect(describeDeadline(CLOSES, at('2026-09-20T16:00:00.000Z'))).toBe('投票還有 10 天（9/30 截止）');
    expect(describeDeadline(CLOSES, at('2026-09-28T10:00:00.000Z'))).toBe('投票還有 3 天（9/30 截止）');
    // The real 9 月獎品 round: closes 10/5 22:52 Taipei.
    expect(describeDeadline(at('2026-10-05T14:52:00.000Z'), at('2026-09-27T06:40:00.000Z'))).toBe('投票還有 9 天（10/5 截止）');
  });

  it('calls the last day the last day', () => {
    // 還有 1 天 reads as tomorrow when it means today, and today is when somebody would act.
    expect(describeDeadline(CLOSES, at('2026-09-30T06:00:00.000Z'))).toBe('投票今天截止');
    expect(describeDeadline(CLOSES, at('2026-09-30T15:59:00.000Z'))).toBe('投票今天截止');
  });

  it('says so once it has passed, rather than counting down past zero', () => {
    expect(describeDeadline(CLOSES, CLOSES)).toBe('投票已結束');
    expect(describeDeadline(CLOSES, at('2026-10-05T00:00:00.000Z'))).toBe('投票已結束');
  });
});
