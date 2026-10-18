import { describe, expect, it, vi } from 'vitest';
import React from 'react';

const { primitive, cardProps, appleProps } = vi.hoisted(() => ({
  primitive: (name: string) => (props: Record<string, unknown>) => require('react').createElement(name, props, props.children as never),
  cardProps: [] as Array<Record<string, unknown>>,
  appleProps: [] as Array<Record<string, unknown>>,
}));
vi.mock('react-native', () => ({
  Image: primitive('Image'),
  ScrollView: primitive('ScrollView'),
  Text: primitive('Text'),
  View: primitive('View'),
  StyleSheet: { create: (value: unknown) => value },
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: primitive('SafeAreaView') }));
vi.mock('../../src/ui/brandIcon', () => ({ BRAND_ICON: 1 }));
vi.mock('../../src/ui/GoogleLoginCard', () => ({
  GoogleLoginCard: (props: Record<string, unknown>) => { cardProps.push(props); return React.createElement('GoogleLoginCard'); },
}));
// AppleLoginCard pulls in the secure-store session module; the screen test only needs to see that it is placed.
vi.mock('../../src/ui/AppleLoginCard', () => ({
  AppleLoginCard: (props: Record<string, unknown>) => { appleProps.push(props); return React.createElement('AppleLoginCard'); },
}));

import { act, create } from 'react-test-renderer';
import { SignInScreen } from '../../src/ui/SignInScreen';

describe('the first screen a new member sees', () => {
  it('says what signing in is for and offers Google and Apple sign-in', () => {
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(React.createElement(SignInScreen, { baseUrl: 'https://api.example.test' })); });
    const text = JSON.stringify(tree.toJSON());
    for (const line of ['竹科聖經', '竹科靈糧堂的每日讀經', '跟著教會的進度讀經，讀完按完成', '經文和靈修都可以聽朗讀', '累積積分換獎品，和朋友互相加油', '第一次登入會自動建立帳號']) {
      expect(text).toContain(line);
    }
    expect(tree.root.findAll((node) => String(node.type) === 'GoogleLoginCard')).toHaveLength(1);
    expect(cardProps.at(-1)).toMatchObject({ baseUrl: 'https://api.example.test', variant: 'welcome' });
    // AppleLoginCard renders nothing outside iOS itself; the screen always places it after Google.
    expect(tree.root.findAll((node) => String(node.type) === 'AppleLoginCard')).toHaveLength(1);
    expect(appleProps.at(-1)).toMatchObject({ baseUrl: 'https://api.example.test' });
  });
});
