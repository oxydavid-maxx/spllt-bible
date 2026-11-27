import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Android system bars over panels follow 夜間模式 (Pixel, 2026-11-05; src/ui/AppModal.tsx). The native part is React
// Native's (ReactModalHostView): these tests pin what AppModal hands it.
vi.mock('react-native', () => ({
  Modal: (props: Record<string, unknown>) => (props.visible ? React.createElement('Modal', props, props.children as React.ReactNode) : null),
  View: 'View', Text: 'Text', StyleSheet: { create: (value: unknown) => value },
}));

import { AppModal, SYSTEM_BARS_SETTLE_MS } from '../../src/ui/AppModal';
import { AppThemeScope } from '../../src/ui/useAppTheme';

let mounts = 0;
function Content() {
  React.useEffect(() => { mounts += 1; }, []);
  return React.createElement('Text', null, '面板');
}
const tree = (scheme: 'light' | 'dark') => React.createElement(AppThemeScope, { scheme },
  React.createElement(AppModal, { visible: true, transparent: true, animationType: 'fade', onRequestClose: () => undefined }, React.createElement(Content)));

describe('AppModal', () => {
  beforeEach(() => { vi.useFakeTimers(); mounts = 0; });
  afterEach(() => { vi.useRealTimers(); });

  it('opens an edge-to-edge dialog: both system bars transparent over the panel, as the app scheme says', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(tree('dark')); });
    const modal = renderer.root.find((node) => String(node.type) === 'Modal');
    expect(modal.props).toMatchObject({ statusBarTranslucent: true, navigationBarTranslucent: true, transparent: true, animationType: 'fade' });
    renderer.unmount();
  });

  it('rebuilds the open dialog once the scheme changes, after the status bar style is in place, keeping its content', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(tree('light')); });
    const flag = () => renderer.root.find((node) => String(node.type) === 'Modal').props.hardwareAccelerated;
    expect(flag()).toBe(false);
    act(() => { renderer.update(tree('dark')); });
    // Not yet: the activity's status bar style is still being set, and the new dialog copies it.
    act(() => { vi.advanceTimersByTime(SYSTEM_BARS_SETTLE_MS - 1); });
    expect(flag()).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(flag()).toBe(true);
    act(() => { renderer.update(tree('light')); });
    act(() => { vi.advanceTimersByTime(SYSTEM_BARS_SETTLE_MS); });
    expect(flag()).toBe(false);
    // The panel's own React content stays mounted through both rebuilds.
    expect(mounts).toBe(1);
    renderer.unmount();
  });
});
