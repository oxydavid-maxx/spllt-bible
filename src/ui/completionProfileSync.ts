import type { ScoreProfile } from '../domain/gamificationV1';
import type { CompletionAwardEvent, CompletionSyncEvent } from '../services/completionController';

export function applyCompletionSyncToProfile(profile: ScoreProfile | null, event: CompletionSyncEvent | CompletionAwardEvent): ScoreProfile | null {
  if (!profile || profile.memberId !== event.memberId) return profile;
  return {
    ...profile,
    ...(event.earnedTotal === undefined ? {} : { earnedTotal: event.earnedTotal }),
    ...(profile.private && event.redeemableBalance !== undefined
      ? { private: { ...profile.private, redeemableBalance: event.redeemableBalance } }
      : {}),
  };
}
