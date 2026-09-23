import { describe, expect, it } from 'vitest';

import { buildAccountSurfaceModel } from '../../src/ui/accountSurface';

describe('account surface', () => {
  it('replaces the sign-in CTA with a verified identity and group context', () => {
    expect(buildAccountSurfaceModel({
      status: 'signed-in',
      profileStatus: 'ready',
      profile: { memberId: 'member:one', displayName: '小明', avatarUrl: null, groupId: 'G01', groupName: 'A小組' },
    })).toEqual({
      mode: 'signed-in',
      displayName: '小明',
      // The first character of this profile's own display name. It read 光 while the fixture was
      // 光佑 and stayed behind when the fixture became 小明, which is the shape of a stale
      // expectation rather than a defect: the code has always taken the first character.
      avatarLabel: '小',
      avatarUrl: null,
      groupName: 'A小組',
      showSignIn: false,
    });
  });

  it('keeps an expired session distinct from signed-out', () => {
    expect(buildAccountSurfaceModel({ status: 'expired', profile: null, profileStatus: 'idle' })).toMatchObject({
      mode: 'reauthenticate',
      showSignIn: true,
    });
  });

  // Review 121 C9 CONTRACT CHANGE. This used to assert that ANY signed-in session without a profile is
  // 'loading'. That is exactly the defect 小明 hit: a request that had already finished and failed kept
  // spinning forever. Only an in-flight load is 'loading' now.
  it('shows loading only while the profile request is genuinely in flight', () => {
    expect(buildAccountSurfaceModel({ status: 'signed-in', profile: null, profileStatus: 'loading' }))
      .toEqual({ mode: 'loading', showSignIn: false });
  });

  it('shows a RETRYABLE error when the profile request finished and failed', () => {
    expect(buildAccountSurfaceModel({ status: 'signed-in', profile: null, profileStatus: 'error' }))
      .toEqual({ mode: 'error', showSignIn: false, canRetry: true });
  });

  it('distinguishes a finished request that returned nothing usable', () => {
    expect(buildAccountSurfaceModel({ status: 'signed-in', profile: null, profileStatus: 'empty' }))
      .toEqual({ mode: 'empty', showSignIn: false, canRetry: true });
  });

  it('never reports loading for a state where nothing is in flight', () => {
    for (const profileStatus of ['error', 'empty'] as const) {
      expect(buildAccountSurfaceModel({ status: 'signed-in', profile: null, profileStatus }).mode).not.toBe('loading');
    }
  });
});
