export interface GroupsRefreshSession {
  memberId: string;
  sessionToken: string;
}

export interface GroupsRemoteState<TSnapshot> {
  memberId: string;
  sessionToken: string;
  snapshot: TSnapshot;
}

/** Stable identity key for a signed-in session, or null when signed out. */
export function sessionKeyOf(session: GroupsRefreshSession | null | undefined): string | null {
  return session ? `${session.memberId}:${session.sessionToken}` : null;
}

/**
 * Decides whether a failed group-snapshot fetch should clear the visible snapshot.
 * A genuinely first load for this session (no prior snapshot yet) still clears to
 * empty; a refetch on regained focus that fails (e.g. offline) keeps the last good
 * snapshot instead of wiping it.
 */
export function shouldClearOnFailedFetch<TSnapshot>(
  previous: GroupsRemoteState<TSnapshot> | null,
  requestSession: GroupsRefreshSession | null | undefined,
): boolean {
  const hasGoodSnapshotForSession =
    previous !== null && requestSession != null && previous.memberId === requestSession.memberId && previous.sessionToken === requestSession.sessionToken;
  return !hasGoodSnapshotForSession;
}
