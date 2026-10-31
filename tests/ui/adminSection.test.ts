import React from 'react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 維護者 2026-10-31:「在這個畫面裡面有兩個管理的地方，我覺得有一點不 consistent」→ A：「同意：我的帳戶管理入口照 A
// 收成一個管理者區塊」. The three administrator entries were a card marked 管理者 ›, a card whose note began
// 只給管理者：, and a faint 全體 (管理) › at the foot of the page. Now one heading over one card of three rows.
vi.hoisted(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
const state = vi.hoisted(() => ({ capabilities: null as null | { canViewAllScores: boolean } }));
const primitive = vi.hoisted(() => (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children));
vi.mock('react-native', () => ({ StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 }, Text: primitive('Text'), View: primitive('View') }));
vi.mock('../../src/services/viewerCapabilities', () => ({ useViewerCapabilities: () => state.capabilities }));
vi.mock('../../src/ui/AdminAllScoresEntry', () => ({ AdminAllScoresEntry: primitive('AllScoresRow') }));
vi.mock('../../src/ui/admin/BackOffice', () => ({ BackOfficeEntry: primitive('BackOfficeRow') }));
vi.mock('../../src/ui/admin/OtaUpdates', () => ({ AdminOtaUpdatesEntry: primitive('OtaRow') }));
import { AdminSection } from '../../src/ui/admin/AdminSection';

let tree: TestRenderer.ReactTestRenderer | null = null;
afterEach(() => { act(() => tree?.unmount()); tree = null; state.capabilities = null; });
const render = async () => { await act(async () => { tree = TestRenderer.create(React.createElement(AdminSection)); }); };

describe('the 管理者 card on 我的帳戶', () => {
  it('shows nothing to a member, or while the role is still unknown', async () => {
    await render();
    expect(tree!.toJSON()).toBeNull();
    act(() => tree!.unmount());
    state.capabilities = { canViewAllScores: false };
    await render();
    expect(tree!.toJSON()).toBeNull();
  });

  it('says 管理者 once and lists 全體, 後台規則與文件 and 先收到測試版更新 in one card, in that order', async () => {
    state.capabilities = { canViewAllScores: true };
    await render();
    const headings = tree!.root.findAll((node) => String(node.type) === 'Text' && node.props.accessibilityRole === 'header');
    expect(headings.map((node) => node.props.children)).toEqual(['管理者 · 只有你看得到']);
    const rows = tree!.root.findAll((node) => ['AllScoresRow', 'BackOfficeRow', 'OtaRow'].includes(String(node.type)));
    expect(rows.map((node) => String(node.type))).toEqual(['AllScoresRow', 'BackOfficeRow', 'OtaRow']);
    // The rows sit together in one card under the heading: the smallest View holding all three holds no heading.
    const holds = (view: TestRenderer.ReactTestInstance, type: string) => view.findAll((node) => String(node.type) === type).length > 0;
    const cards = tree!.root.findAll((node) => String(node.type) === 'View' && ['AllScoresRow', 'BackOfficeRow', 'OtaRow'].every((type) => holds(node, type)));
    const card = cards[cards.length - 1];
    expect(card.findAll((node) => node.props.accessibilityRole === 'header')).toHaveLength(0);
  });
});

describe('no administrator row labels itself again', () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
  it('drops 管理者 ›, 只給管理者： and 全體 (管理) › from the account page rows', () => {
    const text = ['src/ui/AdminAllScoresEntry.tsx', ...files('src/ui/admin')].map((path) => readFileSync(path, 'utf8')).join('\n');
    expect(text).not.toMatch(/>管理者 ›</);
    expect(text).not.toMatch(/>只給管理者：/);
    expect(text).not.toMatch(/>全體 \(管理\) ›</);
  });
});
