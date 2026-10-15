import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
const alert = vi.hoisted(() => vi.fn());
vi.mock('react-native', () => ({ View: 'View', Text: 'Text', Pressable: 'Pressable', Alert: { alert }, StyleSheet: { create: (s: unknown) => s } }));
import { SettingSwitchRow } from '../../src/ui/SettingSwitchRow';
it('has a separate 44px help button that explains without changing the switch (#9)', () => {
  const toggle = vi.fn(); let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(React.createElement(SettingSwitchRow, { label: '接續靈修', description: '經文念完，接著念靈修和詩歌', enabled: false, hint: '目前關閉', help: '白話說明', onPress: toggle })); });
  const help = tree.root.findAll(n => String(n.type) === 'Pressable' && n.props.accessibilityLabel === '接續靈修是什麼')[0];
  expect(help).toBeDefined(); expect(help.props.style).toMatchObject({ width: 44, height: 44 });
  expect(help.parent?.type).toBe('View');
  act(() => help.props.onPress()); expect(alert).toHaveBeenCalledWith('接續靈修是什麼？', '白話說明', [{ text: '知道了' }]); expect(toggle).not.toHaveBeenCalled();
  act(() => tree.root.findAll(n => String(n.type) === 'Pressable' && n.props.accessibilityRole === 'switch')[0].props.onPress()); expect(toggle).toHaveBeenCalledOnce();
  act(() => tree.unmount());
});
