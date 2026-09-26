import { describe, expect, it, vi } from 'vitest';

const { primitive, appState } = vi.hoisted(() => ({
  primitive: (name: string) => (props: Record<string, unknown>) => require('react').createElement(name, props, props.children as never),
  appState: { listener: null as null | ((status: string) => void) },
}));
vi.mock('react-native', () => ({
  Modal: (props: { visible: boolean; children?: unknown }) => (props.visible ? require('react').createElement('Modal', props, props.children as never) : null),
  Pressable: primitive('Pressable'),
  Text: primitive('Text'),
  View: primitive('View'),
  StyleSheet: { create: (value: unknown) => value },
  Linking: { openURL: vi.fn(async () => undefined) },
  AppState: {
    addEventListener: (_event: string, listener: (status: string) => void) => {
      appState.listener = listener;
      return { remove: () => { appState.listener = null; } };
    },
  },
}));

import React from 'react';
import { act, create } from 'react-test-renderer';
import { UpdatePrompt } from '../../src/ui/UpdatePrompt';
import type { UpdateState } from '../../src/services/updateCheck';

// 光佑 (2026-09-26): until the Play listing exists, every member needs a button that takes them to
// the newest build however many releases they skipped. The old notice sat at the bottom of the
// reader's 更多閱讀工具 sheet after the reader redesign, where nobody saw it.

const PAGE = 'https://home.luminexhealthbiohack.com/public/jhuke-bible/';
const UPDATE: UpdateState = { available: true, mandatory: true, versionName: '0.5.16', url: PAGE, note: '10 月起的讀經進度要這一版才看得到。' };
const NONE: UpdateState = { available: false, mandatory: false, versionName: null, url: null, note: null };

async function render(check: () => Promise<UpdateState>) {
  const open = vi.fn();
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(UpdatePrompt, { check, open })); });
  return {
    open,
    tree,
    byLabel: (label: string) => tree.root.findAll((node) => node.props?.accessibilityLabel === label)[0],
    text: () => JSON.stringify(tree.toJSON()),
  };
}

describe('the update prompt', () => {
  it('opens over the app with the newest version, and 更新 goes to the install page', async () => {
    const view = await render(async () => UPDATE);
    expect(view.text()).toContain('有新版本 0.5.16');
    expect(view.text()).toContain('10 月起的讀經進度要這一版才看得到。');
    act(() => { view.byLabel('更新到 0.5.16').props.onPress(); });
    expect(view.open).toHaveBeenCalledWith(PAGE);
  });

  it('lets 稍後 put it away, and asks again when the app comes back to the foreground', async () => {
    const check = vi.fn(async () => UPDATE);
    const view = await render(check);
    act(() => { view.byLabel('稍後再說').props.onPress(); });
    expect(view.text()).not.toContain('有新版本');
    await act(async () => { appState.listener?.('active'); });
    expect(check).toHaveBeenCalledTimes(2);
    expect(view.text()).toContain('有新版本 0.5.16');
  });

  it('shows nothing when the phone already has the newest version or the check fails', async () => {
    const view = await render(async () => NONE);
    expect(view.tree.toJSON()).toBeNull();
  });
});
