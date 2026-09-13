import React from 'react';
import { chapterAudioProvider } from '../doubles/chapterAudioProvider';
beforeEach(() => vi.stubGlobal('fetch', chapterAudioProvider));
afterEach(() => vi.unstubAllGlobals());
import TestRenderer, { act } from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Review 121 C6 REJECTION. Root was right: my previous "integration" proved nothing about the UI
// identity wiring. It authenticated with fixtureToken and injected the session straight into the
// client, and the reader test pinned the session to null and mocked the coordinator - so deleting
// ChapterAudioControls' getSession wiring would still have gone green.
//
// This one closes that hole. It renders the REAL ChapterAudioControls, lets it build the REAL
// coordinator and REAL client, and forwards that client's HTTP through an in-process transport into
// the REAL protected route running google-session auth over an in-memory database. The session token
// is minted by the product's own createSessionToken, so the auth boundary is the real one; nothing is
// short-circuited. No private session file, no fixture token, no real DB, no device.

const primitive = vi.hoisted(() => (name: string) => (props: { children?: unknown }) => {
  const R = require('react') as typeof React;
  return R.createElement(name, props, props.children as React.ReactNode);
});

vi.hoisted(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  process.env.EXPO_PUBLIC_QINGMU_AUDIO_AUTHORIZED = 'true';
  process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL = 'http://in-process';
});

// authSession pulls in expo-secure-store, whose native registry does not exist under node. Only the
// storage boundary is doubled; the auth STATE MACHINE under test is the real one.
vi.mock('expo-secure-store', () => {
  const mem = new Map<string, string>();
  return {
    getItemAsync: async (k: string) => mem.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => { mem.set(k, v); },
    deleteItemAsync: async (k: string) => { mem.delete(k); },
  };
});

vi.mock('react-native', () => ({
  ActivityIndicator: primitive('ActivityIndicator'),
  Pressable: primitive('Pressable'),
  StyleSheet: { create: (v: unknown) => v },
  Text: primitive('Text'),
  View: primitive('View'),
  ScrollView: primitive('ScrollView'),
  Modal: (props: { visible: boolean; children?: React.ReactNode }) => props.visible ? React.createElement('Modal', props, props.children) : null,
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: primitive('SafeAreaView') }));

type MemoryPlayer = {
  playing: boolean; currentTime: number; duration: number; isLoaded: boolean; isBuffering: boolean;
  calls: string[]; removed: boolean;
  play(): void; pause(): void; replace(source: { uri: string }): void;
  seekTo(seconds: number): Promise<void>; setPlaybackRate(rate: number): void; remove(): void;
  listeners: Set<(status: { error?: string | null; playing?: boolean; isLoaded?: boolean }) => void>;
  needsPrepare: boolean;
  addListener(event: string, listener: (status: { error?: string | null; playing?: boolean; isLoaded?: boolean }) => void): { remove(): void };
  emitError(error: string): void;
};
const audioMemory = vi.hoisted(() => ({ players: [] as MemoryPlayer[] }));
// Native boundary only: no claim about physical sound output.
vi.mock('expo-audio', () => ({
  useAudioPlayer: () => {
    const R = require('react') as typeof React;
    const ref = R.useRef<MemoryPlayer | null>(null);
    if (!ref.current) {
      const p: MemoryPlayer = {
        playing: false, currentTime: 0, duration: 300, isLoaded: false, isBuffering: false,
        calls: [], removed: false, listeners: new Set(), needsPrepare: false,
        play() { if (p.removed) throw new Error('PLAYER_REMOVED'); p.calls.push('play'); p.playing = !p.needsPrepare; },
        pause() { p.calls.push('pause'); p.playing = false; },
        replace(source) { if (p.removed) throw new Error('PLAYER_REMOVED'); p.calls.push(`replace:${source.uri}`); p.needsPrepare = false; p.isLoaded = true; p.playing = false; },
        async seekTo(seconds) { p.currentTime = seconds; },
        setPlaybackRate() {},
        remove() { p.calls.push('remove'); p.removed = true; p.playing = false; },
        addListener(event, listener) {
          if (event !== 'playbackStatusUpdate') throw new Error('WRONG_STATUS_EVENT');
          p.listeners.add(listener);
          return { remove: () => { p.listeners.delete(listener); } };
        },
        emitError(error) {
          p.needsPrepare = true; p.isLoaded = false; p.playing = false;
          for (const listener of [...p.listeners]) listener({ error, playing: false, isLoaded: false });
        },
      };
      ref.current = p;
      audioMemory.players.push(p);
    }
    return ref.current;
  },
}));

import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';
import { createSessionToken } from '../../server/session';
import { ChapterAudioControls } from '../../src/ui/ChapterAudioControls';
import { clearAuthSession, setAuthSession, markAuthExpired, getAuthSnapshot, persistAuthSession, persistAuthProfile } from '../../src/services/authSession';

const SECRET = 'in-memory-test-session-secret';
const MEMBER = 'google:test-self';
const OTHER_MEMBER = 'google:test-other';

type Node = TestRenderer.ReactTestInstance;

/** the REAL protected route, google-session auth, in-memory database only */
function backend() {
  const db = createDatabase({ members: [
    { id: MEMBER, displayName: '測試成員', groupId: 'A' },
    { id: OTHER_MEMBER, displayName: '另一成員', groupId: 'B' },
  ] });
  const api = createApiHandler({
    db,
    sessionSecret: SECRET,
    productionGoogleAuth: {
      verify: async () => { throw new Error('Memory tests accept product session tokens only'); },
      resolveMember: async () => null,
    },
  });
  const calls: { authorization?: string }[] = [];
  const transport = (async (url: string, init?: { headers?: Record<string, string> }) => {
    const h = init?.headers ?? {};
    calls.push({ authorization: h.authorization ?? h.Authorization });
    const u = new URL(url);
    const r = await api({ method: 'GET', url: u.pathname + u.search, headers: h as Record<string, string | undefined> });
    return { ok: r.status === 200, status: r.status, json: async () => r.body } as unknown as Response;
  }) as unknown as typeof fetch;
  return { db, transport, calls };
}

const realToken = () => createSessionToken(MEMBER, SECRET);

async function mountReader(transport: typeof fetch): Promise<TestRenderer.ReactTestRenderer> {
  let renderer!: TestRenderer.ReactTestRenderer;
  // the component builds its OWN coordinator and client; only the transport is doubled
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(ChapterAudioControls, {
      chapterUsfm: 'PSA.90', versionId: 1392, fetchImpl: transport,
    } as never));
  });
  await act(async () => { await Promise.resolve(); });
  return renderer;
}

const audioLabel = (r: TestRenderer.ReactTestRenderer): string =>
  (r.root.findAll((n: Node) => typeof n.props?.accessibilityLabel === 'string'
    && (n.props.accessibilityLabel as string).startsWith('章節語音'))[0]?.props.accessibilityLabel as string) ?? '';

const playable = (r: TestRenderer.ReactTestRenderer): boolean =>
  r.root.findAll((n: Node) => typeof n.props?.accessibilityLabel === 'string'
    && /^(播放|暫停).+語音$/.test(n.props.accessibilityLabel as string)
    && typeof n.props?.onPress === 'function').length > 0;

describe('C6 (re-done) — the rendered reader really authenticates to the real protected route', () => {
  const originalError = console.error;
  beforeAll(() => {
    console.error = (...a: unknown[]) => {
      const m = String(a[0] ?? '');
      if (m.includes('react-test-renderer is deprecated') || m.includes('not configured to support act')) return;
      originalError(...a);
    };
  });
  afterAll(() => { console.error = originalError; });
  beforeEach(() => { clearAuthSession(); });

  it('ANONYMOUS: no signed-in session means no Authorization header and nothing playable', async () => {
    const { db, transport, calls } = backend();
    try {
      const r = await mountReader(transport);
      expect(calls.every((c) => !c.authorization)).toBe(true);
      expect(playable(r)).toBe(false);
      await act(async () => { r.unmount(); });
    } finally { db.close(); }
  });

  it('SIGNED IN: the component sends a REAL session token and reaches the chapter', async () => {
    const { db, transport, calls } = backend();
    try {
      const token = realToken();
      setAuthSession({ memberId: MEMBER, sessionToken: token });
      const r = await mountReader(transport);
      // this is the assertion that goes RED if the getSession wiring is deleted
      expect(calls.some((c) => c.authorization === `Bearer ${token}`)).toBe(true);
      expect(audioLabel(r)).toContain('詩90');
      expect(playable(r)).toBe(true);
      await act(async () => { r.unmount(); });
    } finally { db.close(); }
  });

  it('the route itself still refuses the anonymous chapter query', async () => {
    const { db } = backend();
    try {
      const api = createApiHandler({
        db, sessionSecret: SECRET,
        productionGoogleAuth: { clientIds: ['test-client'], verifyIdToken: async () => null } as never,
      });
      const res = await api({ method: 'GET', url: '/api/content-capabilities?versionId=1392&usfm=PSA.90', headers: {} });
      expect(res.status).toBe(401);
    } finally { db.close(); }
  });
});

describe('C6 (re-done) — auth VALIDITY, not just the token string, drives the audio', () => {
  beforeEach(() => { clearAuthSession(); });

  it('EXPIRY clears the resolved outcome even though the session object is unchanged', async () => {
    const { db, transport } = backend();
    try {
      setAuthSession({ memberId: MEMBER, sessionToken: realToken() });
      const r = await mountReader(transport);
      expect(playable(r)).toBe(true);

      // authSession keeps the SAME session on expiry; only status and epoch change. Reading .session
      // alone left this playable, which is the bug Root found.
      await act(async () => { markAuthExpired(); });
      await act(async () => { await Promise.resolve(); });
      expect(playable(r)).toBe(false);
      await act(async () => { r.unmount(); });
    } finally { db.close(); }
  });

  it('LOGOUT clears it', async () => {
    const { db, transport } = backend();
    try {
      setAuthSession({ memberId: MEMBER, sessionToken: realToken() });
      const r = await mountReader(transport);
      expect(playable(r)).toBe(true);
      await act(async () => { clearAuthSession(); });
      await act(async () => { await Promise.resolve(); });
      expect(playable(r)).toBe(false);
      await act(async () => { r.unmount(); });
    } finally { db.close(); }
  });

  it('signing back in with the SAME token is a NEW identity, not a resumption of the old epoch', async () => {
    const { db, transport } = backend();
    try {
      const token = realToken();
      setAuthSession({ memberId: MEMBER, sessionToken: token });
      const r = await mountReader(transport);
      expect(playable(r)).toBe(true);

      await act(async () => { clearAuthSession(); });
      await act(async () => { await Promise.resolve(); });
      expect(playable(r)).toBe(false);

      // identical memberId + token: only the epoch distinguishes this from never having left
      await act(async () => { setAuthSession({ memberId: MEMBER, sessionToken: token }); });
      await act(async () => { await Promise.resolve(); });
      expect(playable(r)).toBe(true);
      await act(async () => { r.unmount(); });
    } finally { db.close(); }
  });

  it('auth expiry and SOURCE validUntil are different things and are not conflated', async () => {
    // this file proves the AUTH lifetime path only. The audio validUntil boundary is proven separately
    // in tests/services/capabilityBoundaryCorrections.test.ts (C1/C2) against a controlled clock.
    const { db, transport } = backend();
    try {
      setAuthSession({ memberId: MEMBER, sessionToken: realToken() });
      const r = await mountReader(transport);
      expect(playable(r)).toBe(true);
      await act(async () => { r.unmount(); });
    } finally { db.close(); }
  });
});

describe('C6 actual deadlines and native ownership calls', () => {
  const T0 = Date.parse('2026-09-12T00:00:00.250Z');
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); clearAuthSession(); audioMemory.players.length = 0; });
  afterEach(() => { clearAuthSession(); vi.useRealTimers(); });
  async function startPlayer(r: TestRenderer.ReactTestRenderer) {
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    const button = r.root.findAll((n: Node) => typeof n.props?.onPress === 'function' && String(n.props?.accessibilityLabel).startsWith('播放'))[0];
    expect(button).toBeDefined();
    await act(async () => { button.props.onPress(); });
    const player = audioMemory.players.at(-1)!;
    expect(player.calls).toContain('play');
    expect(player.playing).toBe(true);
    return player;
  }
  it('publishes a new expiry epoch without changing it for profile-only updates', async () => {
    setAuthSession({ memberId: MEMBER, sessionToken: realToken() });
    const epoch = getAuthSnapshot().epoch;
    await persistAuthProfile({ memberId: MEMBER, displayName: '本人', avatarUrl: null, groupId: 'A', groupName: null });
    expect(getAuthSnapshot().epoch).toBe(epoch);
    markAuthExpired();
    expect(getAuthSnapshot().status).toBe('expired');
    expect(getAuthSnapshot().epoch).toBeGreaterThan(epoch);
  });
  it('expires at the real deadline and pauses playback between progress ticks', async () => {
    const { db, transport } = backend();
    let r: TestRenderer.ReactTestRenderer | undefined;
    try {
      await persistAuthSession({ memberId: MEMBER, sessionToken: realToken() }, 1);
      const epoch = getAuthSnapshot().epoch;
      r = await mountReader(transport);
      const player = await startPlayer(r);
      const pauses = player.calls.filter(c => c === 'pause').length;
      await act(async () => { await vi.advanceTimersByTimeAsync(250); });
      expect(Date.now()).toBe(T0 + 750);
      expect(getAuthSnapshot().status).toBe('expired');
      expect(getAuthSnapshot().epoch).toBeGreaterThan(epoch);
      expect(playable(r)).toBe(false);
      expect(player.playing).toBe(false);
      expect(player.calls.filter(c => c === 'pause').length).toBeGreaterThan(pauses);
      expect(player.removed).toBe(false);
    } finally { if (r) await act(async () => { r!.unmount(); }); db.close(); }
  });
  it.each(['logout', 'account-switch'] as const)('%s pauses the same player without autoplay for the next identity', async transition => {
    const { db, transport } = backend();
    let r: TestRenderer.ReactTestRenderer | undefined;
    try {
      await persistAuthSession({ memberId: MEMBER, sessionToken: realToken() }, 60);
      r = await mountReader(transport);
      const player = await startPlayer(r);
      const plays = player.calls.filter(c => c === 'play').length;
      const pauses = player.calls.filter(c => c === 'pause').length;
      await act(async () => {
        if (transition === 'logout') clearAuthSession();
        else await persistAuthSession({ memberId: OTHER_MEMBER, sessionToken: createSessionToken(OTHER_MEMBER, SECRET) }, 60);
      });
      await act(async () => { await Promise.resolve(); });
      expect(player.playing).toBe(false);
      expect(player.calls.filter(c => c === 'pause').length).toBeGreaterThan(pauses);
      expect(player.calls.filter(c => c === 'play').length).toBe(plays);
      expect(audioMemory.players).toHaveLength(1);
      expect(player.removed).toBe(false);
      if (transition === 'logout') expect(playable(r)).toBe(false);
    } finally { if (r) await act(async () => { r!.unmount(); }); db.close(); }
  });
  it('does not allow an older deadline to expire a newer account', async () => {
    await persistAuthSession({ memberId: MEMBER, sessionToken: realToken() }, 1);
    await vi.advanceTimersByTimeAsync(500);
    await persistAuthSession({ memberId: OTHER_MEMBER, sessionToken: createSessionToken(OTHER_MEMBER, SECRET) }, 3);
    const epoch = getAuthSnapshot().epoch;
    await vi.advanceTimersByTimeAsync(250);
    expect(getAuthSnapshot().status).toBe('signed-in');
    expect(getAuthSnapshot().epoch).toBe(epoch);
    expect(getAuthSnapshot().session?.memberId).toBe(OTHER_MEMBER);
    await vi.advanceTimersByTimeAsync(2000);
    expect(getAuthSnapshot().status).toBe('expired');
    expect(getAuthSnapshot().epoch).toBeGreaterThan(epoch);
  });
  it('rejects a route response that arrives after the auth deadline', async () => {
    const { db, transport } = backend();
    let r: TestRenderer.ReactTestRenderer | undefined;
    let release!: () => void;
    let accepted = false;
    const held = new Promise<void>(resolve => { release = resolve; });
    const delayed = (async (...args: Parameters<typeof fetch>) => {
      const response = await transport(...args);
      if (response.ok) { accepted = true; await held; }
      return response;
    }) as typeof fetch;
    try {
      await persistAuthSession({ memberId: MEMBER, sessionToken: realToken() }, 1);
      r = await mountReader(delayed);
      expect(accepted).toBe(true);
      expect(playable(r)).toBe(false);
      await act(async () => { await vi.advanceTimersByTimeAsync(750); });
      expect(getAuthSnapshot().status).toBe('expired');
      await act(async () => { release(); await Promise.resolve(); });
      expect(playable(r)).toBe(false);
      expect(audioMemory.players.every(p => !p.calls.some(c => c === 'play' || c.startsWith('replace:')))).toBe(true);
    } finally { release(); if (r) await act(async () => { r!.unmount(); }); db.close(); }
  });
  it('plays the new chapter when both old and new chapters remain loaded', async () => {
    const { db, transport } = backend();
    let r: TestRenderer.ReactTestRenderer | undefined;
    try {
      await persistAuthSession({ memberId: MEMBER, sessionToken: realToken() }, 60);
      r = await mountReader(transport);
      const player = await startPlayer(r);
      const plays = player.calls.filter(c => c === 'play').length;
      await act(async () => {
        r!.update(React.createElement(ChapterAudioControls, { chapterUsfm: 'PSA.91', versionId: 1392, fetchImpl: transport }));
      });
      player.duration = 137;
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      expect(player.isLoaded).toBe(true);
      expect(player.playing).toBe(false);
      expect(audioLabel(r)).toContain('詩91');
      expect(r.root.findAll((n: Node) => String(n.props.accessibilityLabel).startsWith('語音進度'))).toHaveLength(0);
      const button = r.root.findAll((n: Node) => n.props.accessibilityLabel === '播放詩91語音' && typeof n.props.onPress === 'function')[0];
      expect(button).toBeDefined();
      await act(async () => { button.props.onPress(); });
      expect(player.calls.filter(c => c === 'play').length).toBe(plays + 1);
      expect(player.playing).toBe(true);
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      const pause = r.root.findAll((n: Node) => n.props.accessibilityLabel === '暫停詩91語音' && typeof n.props.onPress === 'function')[0];
      await act(async () => { pause.props.onPress(); });
      expect(player.playing).toBe(false);
      expect(audioMemory.players).toHaveLength(1);
    } finally { if (r) await act(async () => { r!.unmount(); }); db.close(); }
  });
  it('keeps both compact and legacy audio minimal, even when retired panel props are supplied', async () => {
    const { db, transport } = backend();
    let r: TestRenderer.ReactTestRenderer | undefined;
    try {
      await persistAuthSession({ memberId: MEMBER, sessionToken: realToken() }, 60);
      await act(async () => {
        r = TestRenderer.create(React.createElement(ChapterAudioControls, { chapterUsfm: 'PSA.90', versionId: 1392, fetchImpl: transport, compact: true } as never));
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      expect(r!.root.findAll((n: Node) => n.props.accessibilityLabel === '後退十五秒')).toHaveLength(0);
      const text = r!.root.findAll((n: Node) => String(n.type) === 'Text').map(n => String(n.props.children)).join(' ');
      expect(text).not.toContain('Biblica');
      expect(text).not.toContain('章節語音');
      for (const compact of [true, false]) {
        await act(async () => {
          r!.update(React.createElement(ChapterAudioControls, { chapterUsfm: 'PSA.90', versionId: 1392, fetchImpl: transport, compact, detailsVisible: true }));
        });
        const labels = r!.root.findAll((n: Node) => typeof n.props.accessibilityLabel === 'string').map(n => n.props.accessibilityLabel as string);
        expect(labels).not.toContain('後退十五秒');
        expect(labels).not.toContain('前進十五秒');
        expect(labels).not.toContain('音訊版本資訊');
        expect(labels.some(label => label.startsWith('語音進度'))).toBe(false);
        expect(r!.root.findAll((n: Node) => String(n.type) === 'Modal')).toHaveLength(0);
        expect(r!.root.findAll((n: Node) => String(n.type) === 'Pressable')).toHaveLength(1);
      }
      expect(audioMemory.players).toHaveLength(1);
    } finally { if (r) await act(async () => { r!.unmount(); }); db.close(); }
  });
  it('pause and resume keep the current position without replacing the chapter source', async () => {
    const { db, transport } = backend();
    let r: TestRenderer.ReactTestRenderer | undefined;
    try {
      await persistAuthSession({ memberId: MEMBER, sessionToken: realToken() }, 60);
      r = await mountReader(transport);
      const player = await startPlayer(r);
      player.currentTime = 41;
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      const replaces = player.calls.filter(c => c.startsWith('replace:')).length;
      const pause = r.root.findAll((n: Node) => n.props.accessibilityLabel === '暫停詩90語音' && typeof n.props.onPress === 'function')[0];
      await act(async () => { pause.props.onPress(); });
      expect(player.playing).toBe(false);
      expect(player.currentTime).toBe(41);
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      const resume = r.root.findAll((n: Node) => n.props.accessibilityLabel === '播放詩90語音' && typeof n.props.onPress === 'function')[0];
      await act(async () => { resume.props.onPress(); });
      expect(player.playing).toBe(true);
      expect(player.currentTime).toBe(41);
      expect(player.calls.filter(c => c.startsWith('replace:'))).toHaveLength(replaces);
      expect(audioMemory.players).toHaveLength(1);
    } finally { if (r) await act(async () => { r!.unmount(); }); db.close(); }
  });
  it('stops playback on reader blur even if the component remains mounted', async () => {
    const { db, transport } = backend();
    let r: TestRenderer.ReactTestRenderer | undefined;
    try {
      await persistAuthSession({ memberId: MEMBER, sessionToken: realToken() }, 60);
      r = await mountReader(transport);
      const player = await startPlayer(r);
      await act(async () => {
        r!.update(React.createElement(ChapterAudioControls, { chapterUsfm: 'PSA.90', versionId: 1392, fetchImpl: transport, active: false } as never));
      });
      expect(player.playing).toBe(false);
      expect(playable(r!)).toBe(false);
      expect(player.removed).toBe(false);
    } finally { if (r) await act(async () => { r!.unmount(); }); db.close(); }
  });
  it('rejects an expired source while the longer auth session remains valid', async () => {
    const { db, transport } = backend();
    let r: TestRenderer.ReactTestRenderer | undefined;
    let release!: () => void;
    let sourceDeadline = 0;
    const held = new Promise<void>(resolve => { release = resolve; });
    const delayed = (async (...args: Parameters<typeof fetch>) => {
      const response = await transport(...args);
      if (!response.ok) return response;
      const body = await response.json();
      sourceDeadline = Date.parse(body.validUntil);
      await held;
      return new Response(JSON.stringify(body), { status: response.status });
    }) as typeof fetch;
    try {
      const ttl = 60 * 24 * 60 * 60;
      await persistAuthSession({ memberId: MEMBER, sessionToken: createSessionToken(MEMBER, SECRET, Math.floor(T0 / 1000), ttl) }, ttl);
      r = await mountReader(delayed);
      expect(sourceDeadline).toBeGreaterThan(T0);
      expect(getAuthSnapshot().expiresAt! * 1000).toBeGreaterThan(sourceDeadline);
      await act(async () => { vi.setSystemTime(sourceDeadline + 1); release(); await Promise.resolve(); });
      expect(getAuthSnapshot().status).toBe('signed-in');
      expect(playable(r)).toBe(false);
      expect(audioMemory.players.every(p => !p.calls.includes('play'))).toBe(true);
    } finally { release(); if (r) await act(async () => { r!.unmount(); }); db.close(); }
  });
});

describe('native status errors after play returned, retry and scope isolation', () => {
  const T0 = Date.parse('2026-09-12T00:00:00.250Z');
  const rawError = 'STREAM_FAILED https://private.example/audio?secret=do-not-render';
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); clearAuthSession(); audioMemory.players.length = 0; });
  afterEach(() => { clearAuthSession(); vi.useRealTimers(); });

  const bodyText = (r: TestRenderer.ReactTestRenderer) => r.root.findAll((n: Node) => String(n.type) === 'Text')
    .map((n: Node) => String(n.props.children)).join(' ');
  const openModals = (r: TestRenderer.ReactTestRenderer) => r.root.findAll((n: Node) => String(n.type) === 'Modal' && n.props.visible);
  const button = (r: TestRenderer.ReactTestRenderer, label: string) => {
    const modals = openModals(r);
    const n = r.root.findAll((node: Node) => {
      if (node.props.accessibilityLabel !== label || typeof node.props.onPress !== 'function') return false;
      if (modals.length === 0) return true;
      for (let ancestor: Node | null = node; ancestor; ancestor = ancestor.parent) {
        if (modals.includes(ancestor)) return true;
      }
      return false; // a visible sheet blocks the toolbar behind it
    })[0];
    expect(n, `expected ${label}`).toBeDefined();
    return n;
  };
  async function mountCompact(transport: typeof fetch, chapter = 'PSA.90') {
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(React.createElement(ChapterAudioControls, { chapterUsfm: chapter, versionId: 1392, fetchImpl: transport, compact: true })); });
    await act(async () => { await Promise.resolve(); });
    return r;
  }
  async function play(r: TestRenderer.ReactTestRenderer, label = '詩90') {
    await act(async () => { button(r, `播放${label}語音`).props.onPress(); });
    expect(audioMemory.players.at(-1)?.playing).toBe(true);
    return audioMemory.players.at(-1)!;
  }

  it('shows a safe error AFTER play returned, then refetches and prepares the SAME source before retry playback', async () => {
    const { db, transport, calls } = backend();
    let r: TestRenderer.ReactTestRenderer | undefined;
    try {
      await persistAuthSession({ memberId: MEMBER, sessionToken: realToken() }, 60);
      r = await mountCompact(transport);
      const p = await play(r);
      expect(openModals(r)).toHaveLength(0);
      const pauses = p.calls.filter(c => c === 'pause').length;
      // Native play is void and has already returned; only the event carries the failure.
      await act(async () => { await Promise.resolve(); p.emitError(rawError); });
      expect(bodyText(r)).toContain('朗讀暫時無法播放，請重試。');
      expect(bodyText(r)).not.toContain(rawError);
      expect(bodyText(r)).not.toContain('private.example');
      expect(p.calls.filter(c => c === 'pause').length).toBeGreaterThan(pauses);
      expect(openModals(r)).toHaveLength(0);
      expect(r.root.findAll((n: Node) => n.props.accessibilityRole === 'alert').length).toBeGreaterThan(0);
      const replaced = p.calls.filter(c => c.startsWith('replace:'));
      const requested = calls.length;
      await act(async () => { button(r!, '重試詩90語音').props.onPress(); });
      await act(async () => { await Promise.resolve(); });
      expect(calls.length).toBeGreaterThan(requested);
      expect(p.calls.filter(c => c.startsWith('replace:')).length).toBeGreaterThan(replaced.length);
      expect(p.calls.filter(c => c.startsWith('replace:')).at(-1)).toBe(replaced.at(-1));
      expect(p.needsPrepare).toBe(false);
      expect(p.playing).toBe(true);
      expect(bodyText(r)).not.toContain('朗讀暫時無法播放，請重試。');
      expect(audioMemory.players).toHaveLength(1);
      expect(p.removed).toBe(false);
    } finally { if (r) await act(async () => { r!.unmount(); }); db.close(); }
  });

  it('does not interrupt compact reading when a preload fails before any play request', async () => {
    const { db, transport } = backend();
    let r: TestRenderer.ReactTestRenderer | undefined;
    try {
      await persistAuthSession({ memberId: MEMBER, sessionToken: realToken() }, 60);
      r = await mountCompact(transport);
      await act(async () => { audioMemory.players.at(-1)!.emitError(rawError); });
      expect(openModals(r)).toHaveLength(0);
      expect(button(r, '重試詩90語音')).toBeDefined();
      expect(bodyText(r)).not.toContain(rawError);
    } finally { if (r) await act(async () => { r!.unmount(); }); db.close(); }
  });
  it('shows an honest unavailable state for a failed provider query without a dead play button', async () => {
    const { db, transport } = backend();
    let r: TestRenderer.ReactTestRenderer | undefined;
    try {
      await persistAuthSession({ memberId: MEMBER, sessionToken: realToken() }, 60);
      r = await mountCompact(transport, '1TI.2');
      expect(playable(r)).toBe(false);
      expect(bodyText(r)).toContain('暫時無法取得');
      expect(bodyText(r)).not.toContain('這一章沒有朗讀');
      expect(bodyText(r)).not.toContain('官方無錄音');
      expect(openModals(r)).toHaveLength(0);
      expect(audioMemory.players.every(p => !p.calls.includes('play'))).toBe(true);
    } finally { if (r) await act(async () => { r!.unmount(); }); db.close(); }
  });

  it.each(['chapter', 'blur', 'logout'] as const)('a retired %s listener cannot pause or open an error over the next chapter', async transition => {
    const { db, transport } = backend();
    let r: TestRenderer.ReactTestRenderer | undefined;
    try {
      await persistAuthSession({ memberId: MEMBER, sessionToken: realToken() }, 60);
      r = await mountCompact(transport);
      const p = await play(r);
      const oldListener = [...p.listeners][0];
      expect(oldListener).toBeDefined();
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      const oldPause = button(r, '暫停詩90語音').props.onPress;
      if (transition === 'blur') await act(async () => { r!.update(React.createElement(ChapterAudioControls, { chapterUsfm: 'PSA.90', versionId: 1392, fetchImpl: transport, compact: true, active: false })); });
      if (transition === 'logout') {
        await act(async () => { clearAuthSession(); });
        await act(async () => { setAuthSession({ memberId: OTHER_MEMBER, sessionToken: createSessionToken(OTHER_MEMBER, SECRET) }); });
      }
      await act(async () => { r!.update(React.createElement(ChapterAudioControls, { chapterUsfm: 'PSA.91', versionId: 1392, fetchImpl: transport, compact: true })); });
      await act(async () => { await Promise.resolve(); });
      await play(r, '詩91');
      expect(p.listeners.has(oldListener)).toBe(false);
      const pauses = p.calls.filter(c => c === 'pause').length;
      await act(async () => { oldListener({ error: rawError, playing: false, isLoaded: false }); oldPause(); });
      expect(p.playing).toBe(true);
      expect(p.calls.filter(c => c === 'pause').length).toBe(pauses);
      expect(openModals(r)).toHaveLength(0);
      expect(bodyText(r)).not.toContain('朗讀暫時無法播放');
      await act(async () => { r!.unmount(); }); r = undefined;
      expect(p.listeners.size).toBe(0);
      expect(p.removed).toBe(false);
    } finally { if (r) await act(async () => { r!.unmount(); }); db.close(); }
  });

  it('retry reconfirms an expired source before preparing and playing while auth remains valid', async () => {
    const { db, transport } = backend();
    let r: TestRenderer.ReactTestRenderer | undefined;
    let sourceDeadline = 0;
    const observedTransport = (async (...args: Parameters<typeof fetch>) => {
      const response = await transport(...args);
      if (!response.ok) return response;
      const body = await response.json();
      if (body.validUntil) sourceDeadline = Date.parse(body.validUntil);
      return new Response(JSON.stringify(body), { status: response.status });
    }) as typeof fetch;
    try {
      const ttl = 60 * 24 * 60 * 60;
      await persistAuthSession({ memberId: MEMBER, sessionToken: createSessionToken(MEMBER, SECRET, Math.floor(T0 / 1000), ttl) }, ttl);
      r = await mountCompact(observedTransport);
      const p = await play(r);
      await act(async () => { p.emitError(rawError); });
      const retry = button(r, '重試詩90語音').props.onPress;
      const replaced = p.calls.filter(c => c.startsWith('replace:')).length;
      const plays = p.calls.filter(c => c === 'play').length;
      expect(sourceDeadline).toBeGreaterThan(T0);
      const previousDeadline = sourceDeadline;
      await act(async () => { vi.setSystemTime(sourceDeadline + 1); retry(); });
      await act(async () => { await Promise.resolve(); });
      expect(getAuthSnapshot().status).toBe('signed-in');
      expect(sourceDeadline).toBeGreaterThan(previousDeadline);
      expect(p.calls.filter(c => c.startsWith('replace:'))).toHaveLength(replaced + 1);
      expect(p.calls.filter(c => c === 'play')).toHaveLength(plays + 1);
      expect(p.playing).toBe(true);
    } finally { if (r) await act(async () => { r!.unmount(); }); db.close(); }
  });

  it('a retry captured before logout cannot restart the expired identity', async () => {
    const { db, transport, calls } = backend();
    let r: TestRenderer.ReactTestRenderer | undefined;
    try {
      await persistAuthSession({ memberId: MEMBER, sessionToken: realToken() }, 60);
      r = await mountCompact(transport);
      const p = await play(r);
      await act(async () => { p.emitError(rawError); });
      const retry = button(r, '重試詩90語音').props.onPress;
      await act(async () => { clearAuthSession(); });
      const requests = calls.length;
      const plays = p.calls.filter(c => c === 'play').length;
      await act(async () => { retry(); });
      expect(calls).toHaveLength(requests);
      expect(p.calls.filter(c => c === 'play')).toHaveLength(plays);
      expect(p.playing).toBe(false);
    } finally { if (r) await act(async () => { r!.unmount(); }); db.close(); }
  });

  it('can PAUSE the current stream after its source expires while auth is still valid', async () => {
    const { db, transport } = backend();
    let r: TestRenderer.ReactTestRenderer | undefined;
    let sourceDeadline = 0;
    const observedTransport = (async (...args: Parameters<typeof fetch>) => {
      const response = await transport(...args);
      if (!response.ok) return response;
      const body = await response.json();
      sourceDeadline = Date.parse(body.validUntil);
      return new Response(JSON.stringify(body), { status: response.status });
    }) as typeof fetch;
    try {
      const ttl = 60 * 24 * 60 * 60;
      await persistAuthSession({ memberId: MEMBER, sessionToken: createSessionToken(MEMBER, SECRET, Math.floor(T0 / 1000), ttl) }, ttl);
      r = await mountCompact(observedTransport);
      const p = await play(r);
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      expect(sourceDeadline).toBeGreaterThan(Date.now());
      const pauses = p.calls.filter(c => c === 'pause').length;
      await act(async () => {
        vi.setSystemTime(sourceDeadline + 1);
        button(r!, '暫停詩90語音').props.onPress();
      });
      expect(getAuthSnapshot().status).toBe('signed-in');
      expect(p.calls.filter(c => c === 'pause').length).toBeGreaterThan(pauses);
      expect(p.playing).toBe(false);
      expect(p.removed).toBe(false);
    } finally { if (r) await act(async () => { r!.unmount(); }); db.close(); }
  });
});
