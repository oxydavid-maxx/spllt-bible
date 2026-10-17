import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ platform: 'ios', signIn: vi.fn(), save: vi.fn(), challenge: vi.fn(async () => 'test-nonce'), exchange: vi.fn() }));
vi.mock('react-native', () => ({ Platform: { get OS() { return state.platform; } }, View: 'View', Text: 'Text', StyleSheet: { create: (s: unknown) => s } }));
vi.mock('expo-apple-authentication', () => ({
  isAvailableAsync: async () => true, signInAsync: state.signIn,
  AppleAuthenticationButton: 'AppleAuthenticationButton', AppleAuthenticationScope: { FULL_NAME: 0 },
  AppleAuthenticationButtonType: { SIGN_IN: 0 }, AppleAuthenticationButtonStyle: { BLACK: 0 },
}));
vi.mock('../../src/services/authSession', () => ({ beginAuthSessionAttempt: () => ({ epoch: 1, sequence: 1 }), finishAuthSessionAttempt: vi.fn(), configureAuthSessionTransport: vi.fn(), persistEstablishedAuthSession: state.save }));
vi.mock('../../src/services/apiClient', () => ({ createApiClient: () => ({ appleChallenge: state.challenge, establishAppleSession: state.exchange }) }));
import { AppleLoginCard } from '../../src/ui/AppleLoginCard';
beforeEach(() => { state.platform = 'ios'; state.signIn.mockReset().mockResolvedValue({ identityToken: 'fake-token', authorizationCode: 'fake-code', fullName: null }); state.exchange.mockReset().mockResolvedValue({ sessionToken: 'fake-session', memberId: 'fake-member', expiresInSeconds: null, sessionKind: 'device' }); state.save.mockClear(); });
describe('native Apple login surface', () => {
  it('is absent on Android', async () => {
    state.platform = 'android'; let tree!: ReactTestRenderer;
    await act(async () => { tree = create(React.createElement(AppleLoginCard, { baseUrl: 'https://fixture.invalid' })); });
    expect(tree.toJSON()).toBeNull(); expect(state.signIn).not.toHaveBeenCalled(); await act(async () => tree.unmount());
  });
  it('passes the challenge into native authorization and persists the verified server session, even without a name', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(React.createElement(AppleLoginCard, { baseUrl: 'https://fixture.invalid' })); });
    await act(async () => tree.root.findByProps({ accessibilityLabel: '使用Apple登入' }).props.onPress());
    expect(state.signIn).toHaveBeenCalledWith({ requestedScopes: [0], nonce: 'test-nonce' });
    expect(state.exchange).toHaveBeenCalledWith({ identityToken: 'fake-token', authorizationCode: 'fake-code', nonce: 'test-nonce', displayName: '' });
    expect(state.save.mock.calls[0][0]).toMatchObject({ memberId: 'fake-member' }); await act(async () => tree.unmount());
  });
});
