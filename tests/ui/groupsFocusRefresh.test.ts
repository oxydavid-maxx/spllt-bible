import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-router', () => ({ Redirect: (props: Record<string, unknown>) => React.createElement('Redirect', props) }));

import GroupsScreen from '../../app/(tabs)/groups';

describe('retired groups route', () => {
  it('redirects old group links to the reading entry', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(GroupsScreen)); });
    expect(renderer.root.findByType('Redirect' as any).props.href).toBe('/(tabs)/today');
    renderer.unmount();
  });
});
