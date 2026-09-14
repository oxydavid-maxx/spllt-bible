import { describe, expect, it } from 'vitest';
import {
  calculateBand,
  canonicalMemberPair,
  isWithinCompletionWindow,
  monthBuckets,
} from '../../src/domain/gamificationV1';
import { hashFriendToken } from '../../server/gamification';

describe('gamification v1 domain rules', () => {
  it('allows only Taipei today and the preceding six calendar days', () => {
    expect(isWithinCompletionWindow('2026-09-14', '2026-09-14')).toBe(true);
    expect(isWithinCompletionWindow('2026-09-08', '2026-09-14')).toBe(true);
    expect(isWithinCompletionWindow('2026-09-07', '2026-09-14')).toBe(false);
    expect(isWithinCompletionWindow('2026-09-15', '2026-09-14')).toBe(false);
    expect(isWithinCompletionWindow('2026-09-01', '2026-09-01')).toBe(true);
    expect(isWithinCompletionWindow('2026-08-31', '2026-09-01')).toBe(true);
  });

  it('uses the Taipei calendar date at midnight boundaries', () => {
    expect(isWithinCompletionWindow('2026-09-08', '2026-09-14')).toBe(true);
    expect(isWithinCompletionWindow('2026-09-07', '2026-09-14')).toBe(false);
  });

  it('calculates bands from strict higher totals and leaves small or zero samples unbanded', () => {
    expect(calculateBand(0, [0, 20, 30, 40, 50, 60, 70, 80, 90, 100])).toBeNull();
    expect(calculateBand(40, [10, 20, 30, 40, 50, 60, 70, 80, 90, 100])).toBe(4);
    expect(calculateBand(50, [50, 50, 20, 10, 0, 0, 0, 0, 0, 0, 5, 5, 5, 5, 5, 5])).toBe(1);
    expect(calculateBand(20, [10, 20, 30, 40, 50, 60, 70, 80, 90])).toBeNull();
  });

  it('canonicalizes friendship pairs and hashes the opaque token', () => {
    expect(canonicalMemberPair('member-b', 'member-a')).toEqual({ memberLow: 'member-a', memberHigh: 'member-b' });
    expect(canonicalMemberPair('same', 'same')).toBeNull();
    expect(hashFriendToken('opaque-token')).toMatch(/^[a-f0-9]{64}$/);
    expect(hashFriendToken('opaque-token')).toBe(hashFriendToken('opaque-token'));
  });

  it('returns six month buckets ending at the requested month', () => {
    expect(monthBuckets('2026-01')).toEqual(['2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01']);
    expect(monthBuckets('2026-09')).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
  });
});
