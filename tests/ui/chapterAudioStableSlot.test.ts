import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { process.env.EXPO_PUBLIC_QINGMU_FIXTURE = 'false'; (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
const primitive = vi.hoisted(() => (name: string) => (props: any) => require('react').createElement(name, props, props.children));
vi.mock('react-native', () => ({
  TextInput: primitive('TextInput'), View: primitive('View'), Text: primitive('Text'), Pressable: primitive('Pressable'),
  ActivityIndicator: primitive('ActivityIndicator'), StyleSheet: { create: (value: unknown) => value },
}));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }));
const nativePlayer = vi.hoisted(() => ({ play() {}, pause() {}, seekTo: async () => {}, replace() {}, addListener: () => ({ remove() {} }), currentTime: 0, duration: 0, playing: false, isLoaded: false, isBuffering: false }));
vi.mock('expo-audio', () => ({ useAudioPlayer: () => nativePlayer }));

import { ChapterAudioControls } from '../../src/ui/ChapterAudioControls';
import { clearAuthSession, setAuthSession } from '../../src/services/authSession';

const payload = (audio: boolean, status = audio ? 'verified_source' : 'explicit_no_audio') => ({
  identity: { versionId: 46, usfm: '1TI.1' }, text: true, audio, offline: false, status,
  reason: '', uri: audio ? 'https://example.test/1TI.1.mp3' : undefined,
  providerExpiry: null, validUntil: new Date(Date.now() + 300_000).toISOString(),
  provenance: { publisher: 'Test publisher', edition: 'Test edition', recordingId: 'test-source', reference: '1TI.1', attribution: 'Test attribution' },
});

let view: TestRenderer.ReactTestRenderer | null = null;
let fetchImpl: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setAuthSession({ memberId: 'test:A', sessionToken: 'synthetic-session-A' });
  fetchImpl = vi.fn(async () => new Response(JSON.stringify(payload(false))));
});
afterEach(async () => { if (view) await act(async () => view!.unmount()); view = null; clearAuthSession(); });

const mount = (active = true) => act(() => {
  view = TestRenderer.create(React.createElement(ChapterAudioControls, {
    chapterUsfm: '1TI.1', versionId: 46, active, fetchImpl: fetchImpl as typeof fetch,
    env: { EXPO_PUBLIC_QINGMU_AUDIO_AUTHORIZED: 'true' }, baseUrl: 'https://in-memory.test',
  }));
});

describe('ChapterAudioControls stable slot', () => {
  it('keeps an empty fixed slot hidden from accessibility when inactive', async () => {
    mount(false);
    const root = view!.root.findAll(node => String(node.type) === 'View')[0];
    expect(root.props.style).toMatchObject({ width: 48, height: 48, flexShrink: 0 });
    expect(root.props.accessibilityElementsHidden).toBe(true);
    expect(root.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(view!.root.findAll(node => String(node.type) === 'Pressable')).toHaveLength(0);
  });

  it('renders loading and no-audio as icons in the same fixed slot without normal status text', async () => {
    let release!: (value: Response) => void;
    fetchImpl.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }));
    mount();
    const slot = view!.root.findAll(node => String(node.type) === 'View')[1];
    expect(slot.props.style).toMatchObject({ width: 48, height: 48, flexShrink: 0 });
    expect(slot.props.accessibilityState).toMatchObject({ busy: true });
    expect(view!.root.findAll(node => String(node.type) === 'Text').map((node) => String(node.props.children)).join(' ')).not.toContain('正在取得本章語音');
    await act(async () => release(new Response(JSON.stringify(payload(false)) )));
    const labels = view!.root.findAll(node => String(node.type) === 'Text').map((node) => node.props.accessibilityLabel).filter(Boolean);
    expect(labels).toContain('本章沒有朗讀');
  });
});
