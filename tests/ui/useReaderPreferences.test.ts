import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { createReaderPreferencesStore } from '../../src/services/readerPreferences';
import { useReaderPreferences } from '../../src/ui/useReaderPreferences';

vi.hoisted(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
const options = { allowedVersionIds: [46, 1392], defaultVersionId: 46 };

describe('mounted preference subscription follows the current account at render time', () => {
  it('never flashes A values on B, then restores A when switching back', async () => {
    const reads: { key: string; resolve: (value: string | null) => void }[] = [];
    const storage = { getItem: (key: string) => new Promise<string | null>(resolve => reads.push({ key, resolve })), setItem: async () => {} };
    const store = createReaderPreferencesStore(storage, options);
    await store.update('A', { versionId: 1392, settings: { fontSize: 24, fontFamily: 'Inter', lineSpacing: 1.8 } });
    const seen: { owner: string | null; ready: boolean; versionId: number }[] = [];
    const Probe = ({ memberId }: { memberId: string | null }) => {
      const snapshot = useReaderPreferences(memberId, store);
      seen.push({ owner: memberId, ready: snapshot.ready, versionId: snapshot.preferences.versionId });
      return React.createElement('PreferenceProbe', snapshot);
    };
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(Probe, { memberId: 'A' })); });
    await act(async () => { renderer.update(React.createElement(Probe, { memberId: 'B' })); });
    expect(seen.filter(x => x.owner === 'B').every(x => !x.ready && x.versionId === 46)).toBe(true);
    await act(async () => { renderer.update(React.createElement(Probe, { memberId: 'A' })); });
    await act(async () => { reads[0].resolve(JSON.stringify({ schemaVersion: 1, owner: 'B', preferences: { versionId: 46, settings: null } })); });
    expect(seen.at(-1)).toEqual({ owner: 'A', ready: true, versionId: 1392 });
    await act(async () => { renderer.unmount(); });
  });

  it('switches to a fresh memory-only guest snapshot and unsubscribes on unmount', async () => {
    const storage = { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) };
    const store = createReaderPreferencesStore(storage, options);
    await store.update('A', { versionId: 1392 });
    const originalSubscribe = store.subscribe;
    const unsubscribed = vi.fn();
    const subscribe = vi.spyOn(store, 'subscribe').mockImplementation(listener => {
      const unsubscribe = originalSubscribe(listener);
      return () => { unsubscribed(); unsubscribe(); };
    });
    const Probe = ({ memberId }: { memberId: string | null }) => React.createElement('PreferenceProbe', useReaderPreferences(memberId, store));
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(Probe, { memberId: 'A' })); });
    await act(async () => { renderer.update(React.createElement(Probe, { memberId: null })); });
    const view = renderer.root.findAll(n => String(n.type) === 'PreferenceProbe')[0];
    expect(view.props.preferences).toEqual({ versionId: 46, settings: null });
    expect(view.props.ready).toBe(true);
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(subscribe).toHaveBeenCalled();
    await act(async () => { renderer.unmount(); });
    expect(unsubscribed).toHaveBeenCalledTimes(subscribe.mock.calls.length);
    await store.update(null, { versionId: 1392 });
  });
});
