import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));
vi.mock('react-native', () => ({ Text: 'Text', TextInput: 'TextInput', View: 'View' }));
vi.mock('../../src/ui/GoogleLoginCard', () => ({ GoogleLoginCard: ({ baseUrl }: { baseUrl: string }) => React.createElement('GoogleLoginCard', { baseUrl }) }));
vi.mock('../../src/ui/StatusCard', () => ({ StatusCard: ({ title }: { title: string }) => React.createElement('StatusCard', { title }) }));

import { clearAuthSession, setAuthSession } from '../../src/services/authSession';
import { TodayAuthGate } from '../../src/ui/TodayAuthGate';

describe('mounted Today auth entry', () => {
  const originalError = console.error;
  beforeAll(() => { console.error = (...args: unknown[]) => { const message = String(args[0] ?? ''); if (message.includes('react-test-renderer is deprecated') || message.includes('testing environment is not configured to support act')) return; originalError(...args); }; });
  afterAll(() => { console.error = originalError; });

  it('removes the Google CTA after the root snapshot becomes signed-in', () => {
    clearAuthSession();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(TodayAuthGate, { baseUrl: 'http://example.test' })); });
    expect(renderer.root.findAll((node) => String(node.type) === 'GoogleLoginCard')).toHaveLength(1);
    act(() => { setAuthSession({ memberId: 'member:one', sessionToken: 'session' }); renderer.update(React.createElement(TodayAuthGate, { baseUrl: 'http://example.test' })); });
    expect(renderer.root.findAll((node) => String(node.type) === 'GoogleLoginCard')).toHaveLength(0);
    expect(renderer.root.findAll((node) => String(node.type) === 'Text').map((node) => node.props.children).join(' ')).toContain('已登入');
    renderer.unmount();
  });
});
