/**
 * Development-only profile. A release build must replace this with a verified
 * Google session and a server-assigned fixed group before showing member data.
 */
export const fixtureProfile = {
  enabled: true,
  memberId: 'fixture:self',
  displayName: '小明',
  groupId: 'G01',
} as const;
