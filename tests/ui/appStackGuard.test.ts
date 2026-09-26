import { describe, expect, it, vi } from 'vitest';
import React from 'react';

// 光佑 2026-09-26: the app should ask people to sign in the first time it opens. Before, a new member
// landed on the reader with sign-in tucked inside the reader's ⋯ menu, so completion and the journal
// silently did nothing. Expo Router's Stack.Protected keeps every app screen behind sign-in and the
// sign-in screen out of reach once signed in.

vi.mock('expo-router', () => {
  const Screen = (props: Record<string, unknown>) => React.createElement('Screen', props);
  const Protected = (props: Record<string, unknown>) => React.createElement('Protected', props, props.children as React.ReactNode);
  const Stack = (props: Record<string, unknown>) => React.createElement('Stack', props, props.children as React.ReactNode);
  Object.assign(Stack, { Screen, Protected });
  return { Stack };
});

import { act, create } from 'react-test-renderer';
import { AppStack, canUseApp } from '../../src/ui/AppStack';

function guards(signedIn: boolean) {
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(React.createElement(AppStack, { signedIn })); });
  return tree.root.findAll((node) => String(node.type) === 'Protected').map((group) => ({
    guard: group.props.guard as boolean,
    screens: group.findAll((node) => String(node.type) === 'Screen').map((screen) => screen.props.name as string),
  }));
}

describe('sign-in comes first', () => {
  it('keeps every app screen behind sign-in and only the sign-in screen outside it', () => {
    expect(guards(false)).toEqual([
      { guard: false, screens: ['index', '(tabs)', 'account'] },
      { guard: true, screens: ['sign-in'] },
    ]);
  });

  it('opens the app and closes the sign-in screen once signed in', () => {
    expect(guards(true)).toEqual([
      { guard: true, screens: ['index', '(tabs)', 'account'] },
      { guard: false, screens: ['sign-in'] },
    ]);
  });

  it('lets a returning member straight in while their saved session is restored, and sends signed-out or expired sessions to sign in', () => {
    expect(canUseApp('signed-in')).toBe(true);
    expect(canUseApp('hydrating')).toBe(true);
    expect(canUseApp('signed-out')).toBe(false);
    expect(canUseApp('expired')).toBe(false);
  });
});
