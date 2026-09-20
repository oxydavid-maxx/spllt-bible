import { describe, expect, it } from 'vitest';
import { describeDeadline } from '../../src/domain/nominationRound';

const at = (iso: string) => Date.parse(iso);
const CLOSES = at('2026-09-30T16:00:00.000Z');

describe('how long is left to vote', () => {
  it('counts the days while there are days', () => {
    expect(describeDeadline(CLOSES, at('2026-09-20T16:00:00.000Z'))).toBe('還有 10 天');
    expect(describeDeadline(CLOSES, at('2026-09-28T10:00:00.000Z'))).toBe('還有 3 天');
  });

  it('calls the last day the last day', () => {
    // 還有 1 天 reads as tomorrow when it means today, and today is when somebody would act.
    expect(describeDeadline(CLOSES, at('2026-09-30T06:00:00.000Z'))).toBe('今天截止');
    expect(describeDeadline(CLOSES, at('2026-09-30T15:59:00.000Z'))).toBe('今天截止');
  });

  it('says so once it has passed, rather than counting down past zero', () => {
    expect(describeDeadline(CLOSES, CLOSES)).toBe('投票已結束');
    expect(describeDeadline(CLOSES, at('2026-10-05T00:00:00.000Z'))).toBe('投票已結束');
  });
});
