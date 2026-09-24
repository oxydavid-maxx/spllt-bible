import { describe, expect, it } from 'vitest';
import type { ScoreProfile } from '../../src/domain/gamificationV1';
import type { CompletionSyncEvent } from '../../src/services/completionController';
import { applyCompletionSyncToProfile } from '../../src/ui/completionProfileSync';

const profile: ScoreProfile = {
  memberId: 'member-profile-sync', displayName: '小明', earnedTotal: 12, band: null, months: [],
  private: { redeemableBalance: 4, targetReward: null },
  permissions: { canEditTarget: true, canRedeem: true },
};

describe('profile refresh from confirmed completion', () => {
  it('applies undo totals for the operation member even when the task date is from an earlier plan', () => {
    const event: CompletionSyncEvent = {
      memberId: profile.memberId, planId: 'church-2026-08', taskDate: '2026-08-31', operationId: 'undo-old-month',
      status: 'NOT_COMPLETED', pointsDelta: -1, earnedTotal: 11, redeemableBalance: 3,
    };
    expect(applyCompletionSyncToProfile(profile, event)).toMatchObject({
      memberId: profile.memberId,
      earnedTotal: 11,
      private: { redeemableBalance: 3 },
    });
  });

  it('refreshes totals when a legacy server omits pointsDelta', () => {
    const event: CompletionSyncEvent = {
      memberId: profile.memberId, planId: 'church-2026-09', taskDate: '2026-09-01', operationId: 'legacy-complete',
      status: 'COMPLETED', earnedTotal: 13, redeemableBalance: 5,
    };
    expect(applyCompletionSyncToProfile(profile, event)).toMatchObject({ earnedTotal: 13, private: { redeemableBalance: 5 } });
  });

  it('does not apply another member’s completion response to this profile', () => {
    const event: CompletionSyncEvent = {
      memberId: 'member-other', planId: 'church-2026-09', taskDate: '2026-09-01', operationId: 'other-member',
      status: 'COMPLETED', pointsDelta: 1, earnedTotal: 99, redeemableBalance: 99,
    };
    expect(applyCompletionSyncToProfile(profile, event)).toBe(profile);
  });
});
