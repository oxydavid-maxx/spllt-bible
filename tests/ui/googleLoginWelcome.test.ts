import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';

const { primitive } = vi.hoisted(() => ({
  primitive: (name: string) => (props: Record<string, unknown>) => require('react').createElement(name, props, props.children as never),
}));
vi.mock('react-native', () => ({
  Pressable: primitive('Pressable'),
  Text: primitive('Text'),
  TextInput: primitive('TextInput'),
  View: primitive('View'),
  StyleSheet: { create: (value: unknown) => value },
}));
vi.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: vi.fn() }));
vi.mock('../../src/services/apiClient', () => ({ createApiClient: vi.fn() }));
vi.mock('../../src/services/googleNative', () => ({ obtainGoogleIdToken: vi.fn() }));
vi.mock('../../src/services/authSession', () => ({
  beginAuthSessionAttempt: vi.fn(), finishAuthSessionAttempt: vi.fn(), configureAuthSessionTransport: vi.fn(), persistEstablishedAuthSession: vi.fn(),
}));

import { act, create } from 'react-test-renderer';
import { GoogleLoginCard } from '../../src/ui/GoogleLoginCard';

const previousClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
beforeEach(() => { process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'client.apps.googleusercontent.com'; });
afterEach(() => { process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = previousClientId; });

function render(variant?: 'card' | 'welcome') {
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(React.createElement(GoogleLoginCard, { baseUrl: 'https://api.example.test', ...(variant ? { variant } : {}) })); });
  return { text: JSON.stringify(tree.toJSON()), button: tree.root.findAll((node) => node.props?.accessibilityLabel === '使用Google登入')[0] };
}

describe('Google sign-in on the welcome screen', () => {
  it('is one large button without the card heading', () => {
    const welcome = render('welcome');
    expect(welcome.text).not.toContain('Google身份');
    expect(welcome.text).toContain('用 Google 登入');
    expect(welcome.button).toBeDefined();
  });

  it('keeps the card as it was everywhere else', () => {
    const card = render();
    expect(card.text).toContain('Google身份');
    expect(card.text).toContain('使用Google登入');
  });
});
