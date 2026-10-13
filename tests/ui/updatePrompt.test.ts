import { afterEach, describe, expect, it, vi } from 'vitest';

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
import { UpdateCard } from '../../src/ui/UpdateCard';
import type { UpdateState } from '../../src/services/updateCheck';

// 光佑 (2026-09-26): until the Play listing exists, every member needs a button that takes them to
// the newest build however many releases they skipped. The old notice sat at the bottom of the
// reader's 更多閱讀工具 sheet after the reader redesign, where nobody saw it.

const PAGE = 'https://home.luminexhealthbiohack.com/public/jhuke-bible/';
const UPDATE: UpdateState = { available: true, mandatory: true, versionName: '0.5.16', url: PAGE, note: '10 月起的讀經進度要這一版才看得到。' };
const NONE: UpdateState = { available: false, mandatory: false, versionName: null, url: null, note: null };
const LISTING = 'https://play.google.com/store/apps/details?id=org.qingmu.youth';
const PLAY: UpdateState = { available: true, mandatory: false, versionName: null, url: LISTING, note: null, viaPlay: true };

const mounted: Array<ReturnType<typeof create>> = [];
afterEach(() => { mounted.splice(0).forEach((tree) => act(() => tree.unmount())); vi.useRealTimers(); });

async function render(check: () => Promise<UpdateState>, start: () => Promise<boolean> = async () => true) {
  const open = vi.fn();
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(UpdatePrompt, { check, open, start })); });
  mounted.push(tree);
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

  it('asks once more a little later when the first check found nothing, as on a phone that just woke without network', async () => {
    vi.useFakeTimers();
    const check = vi.fn<() => Promise<UpdateState>>().mockResolvedValueOnce(NONE).mockResolvedValue(UPDATE);
    const view = await render(check);
    expect(view.tree.toJSON()).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(check).toHaveBeenCalledTimes(2);
    expect(view.text()).toContain('有新版本 0.5.16');
  });

  // 光佑 (2026-10-13): same prompt as before, but a Play install updates inside the app.
  it('updates a Play install inside the app instead of opening a page', async () => {
    const start = vi.fn(async () => true);
    const view = await render(async () => PLAY, start);
    expect(view.text()).toContain('有新版本');
    expect(view.text()).toContain('Google Play');
    expect(view.text()).not.toContain('null');
    await act(async () => { view.byLabel('更新').props.onPress(); });
    expect(start).toHaveBeenCalledOnce();
    expect(view.open).not.toHaveBeenCalled();
  });

  it('opens the Play listing when Play cannot start the update in the app', async () => {
    const view = await render(async () => PLAY, async () => false);
    await act(async () => { view.byLabel('更新').props.onPress(); });
    expect(view.open).toHaveBeenCalledWith(LISTING);
  });

  it('shows nothing when the phone already has the newest version or the check fails', async () => {
    const view = await render(async () => NONE);
    expect(view.tree.toJSON()).toBeNull();
  });
});

// 光佑 (2026-09-27): if the prompt is dismissed by mistake, the update must still be findable. The
// notice board carries a card for as long as the phone is behind.
describe('the update card on the notice board', () => {
  it('shows the newest version while the phone is behind, and 更新 goes to the install page', () => {
    const onUpdate = vi.fn();
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(React.createElement(UpdateCard, { state: UPDATE, onUpdate })); });
    mounted.push(tree);
    expect(JSON.stringify(tree.toJSON())).toContain('有新版本 0.5.16');
    act(() => { tree.root.findAll((node) => node.props?.accessibilityLabel === '更新到 0.5.16')[0].props.onPress(); });
    expect(onUpdate).toHaveBeenCalledWith(PAGE);
  });

  it('is absent when the phone is up to date', () => {
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(React.createElement(UpdateCard, { state: NONE, onUpdate: vi.fn() })); });
    mounted.push(tree);
    expect(tree.toJSON()).toBeNull();
  });
});
