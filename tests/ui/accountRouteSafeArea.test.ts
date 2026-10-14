import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

// The app draws edge to edge (Android 15+ with targetSdk 35+) and the account page has no tab bar to
// absorb the system navigation bar, so on 0.5.24 the version line at the bottom sat under the bar and
// showed only as 版本 0.5.24 (4. The route keeps its bottom edge in the safe area.
vi.mock('react-native', () => ({ StyleSheet: { create: (value: unknown) => value } }));
vi.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
vi.mock('../../src/ui/accountSurfaceComponent', () => ({ AccountSurface: 'AccountSurface' }));
vi.mock('../../src/ui/AdminAllScoresEntry', () => ({ AdminAllScoresEntry: 'AdminAllScoresEntry' }));
import AccountScreen from '../../app/account';
import { theme } from '../../src/ui/Theme';

describe('account route', () => {
  it('keeps the page above the system navigation bar', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(AccountScreen)); });
    const area = renderer.root.find(node => String(node.type) === 'SafeAreaView');
    expect(area.props.edges).toContain('bottom');
    expect(area.props.style).toMatchObject({ flex: 1, backgroundColor: theme.colors.background });
    expect(area.findAll(node => String(node.type) === 'AccountSurface')).toHaveLength(1);
    await act(async () => { renderer.unmount(); });
  });
});
