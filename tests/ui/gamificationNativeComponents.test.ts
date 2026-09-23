import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const { primitive, requestPermission, authenticateAsync } = vi.hoisted(() => ({ primitive: (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children), requestPermission: vi.fn(async () => ({ granted: true, status: 'granted' })), authenticateAsync: vi.fn(async () => ({ success: true })) }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' }, AppState: { currentState: 'active', addEventListener: () => ({ remove: () => undefined }) }, ActivityIndicator: primitive('ActivityIndicator'), Pressable: primitive('Pressable'), Text: primitive('Text'), TextInput: primitive('TextInput'), View: primitive('View'), StyleSheet: { create: (value: unknown) => value } }));
vi.mock('expo-camera', () => ({ CameraView: (props: any) => React.createElement('CameraView', props), useCameraPermissions: () => [{ granted: false, status: 'undetermined' }, requestPermission] }));
vi.mock('react-native-qrcode-svg', () => ({ default: (props: any) => React.createElement('QRCode', props) }));
vi.mock('expo-local-authentication', () => ({ authenticateAsync }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => undefined }));

import { FriendQrPanel } from '../../src/ui/gamification/FriendQrPanel';
import { createNativeAdminAuthenticator } from '../../src/services/adminUnlockGuard';
import { GamificationApiError } from '../../src/services/gamificationApiClient';

describe('native gamification adapters', () => {
  it('renders the real QR component with the Qingmu payload and refreshes expiring codes', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-14T14:00:00Z'));
      const client = { createFriendQr: vi.fn()
        .mockResolvedValueOnce({ token: 'opaque', payload: 'qingmu://friend/add?token=opaque', expiresAt: Date.now() + 30_000 })
        .mockResolvedValue({ token: 'fresh', payload: 'qingmu://friend/add?token=fresh', expiresAt: Date.now() + 300_000 }), claimFriendQr: vi.fn() };
      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => { renderer = TestRenderer.create(React.createElement(FriendQrPanel, { client, mode: 'show' })); });
      expect(renderer.root.findByType('QRCode' as any).props.value).toContain('qingmu://friend/add?token=opaque');
      await act(async () => { vi.advanceTimersByTime(30_000); await Promise.resolve(); });
      expect(client.createFriendQr).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  it('requests camera permission through expo-camera and configures QR-only scanning', async () => {
    const client = { createFriendQr: vi.fn(), claimFriendQr: vi.fn(async () => ({ memberId: 'owner' })) };
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(FriendQrPanel, { client, mode: 'scan' })); });
    const button = renderer.root.findAll((node) => String(node.type) === 'Pressable')[0];
    await act(async () => { button.props.onPress(); });
    expect(requestPermission).toHaveBeenCalledTimes(1);
    const camera = renderer.root.findByType('CameraView' as any);
    expect(camera.props.barcodeScannerSettings).toEqual({ barcodeTypes: ['qr'] });
    await act(async () => { camera.props.onBarcodeScanned({ data: 'qingmu://friend/add?token=once' }); camera.props.onBarcodeScanned({ data: 'qingmu://friend/add?token=once' }); await Promise.resolve(); });
    expect(client.claimFriendQr).toHaveBeenCalledTimes(1);
  });

  async function scanner(client: { createFriendQr: ReturnType<typeof vi.fn>; claimFriendQr: ReturnType<typeof vi.fn> }) {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(FriendQrPanel, { client, mode: 'scan' })); });
    await act(async () => { renderer.root.findAll((node) => String(node.type) === 'Pressable')[0].props.onPress(); });
    return renderer;
  }
  const alerts = (renderer: TestRenderer.ReactTestRenderer) => renderer.root.findAll((node) => String(node.type) === 'Text' && node.props.accessibilityRole === 'alert').map((node) => node.props.children).join(' ');
  it('reports a non-Qingmu code without sending it to the server or opening its URL', async () => {
    const client = { createFriendQr: vi.fn(), claimFriendQr: vi.fn() };
    const renderer = await scanner(client);
    await act(async () => { renderer.root.findByType('CameraView' as any).props.onBarcodeScanned({ data: 'https://not-qingmu.invalid' }); });
    expect(client.claimFriendQr).not.toHaveBeenCalled();
    expect(alerts(renderer)).toContain('這不是青牧好友碼');
  });
  it('shows a rejected or expired claim in the scanner pane', async () => {
    const failure = new GamificationApiError('FRIEND_QR_EXPIRED', false, 409);
    const client = { createFriendQr: vi.fn(), claimFriendQr: vi.fn(async () => { throw failure; }) };
    const renderer = await scanner(client);
    await act(async () => { renderer.root.findByType('CameraView' as any).props.onBarcodeScanned({ data: 'qingmu://friend/add?token=expired' }); });
    expect(alerts(renderer)).toBe(failure.userMessage);
    expect(renderer.root.findAll((node) => node.props.accessibilityLabel === '開啟相機掃描好友碼').length).toBeGreaterThan(0);
  });
  it.each(['SELF_FRIEND_NOT_ALLOWED', 'AUTH_INVALID', 'NETWORK_ERROR'])('preserves the existing human API message for %s', async (code) => {
    const failure = new GamificationApiError(code, code === 'NETWORK_ERROR', code === 'AUTH_INVALID' ? 401 : 409);
    const renderer = await scanner({ createFriendQr: vi.fn(), claimFriendQr: vi.fn(async () => { throw failure; }) });
    await act(async () => renderer.root.findByType('CameraView' as any).props.onBarcodeScanned({ data: 'qingmu://friend/add?token=error' }));
    expect(alerts(renderer)).toBe(failure.userMessage);
  });
  it('uses a general retry message for an unknown claim failure', async () => {
    const renderer = await scanner({ createFriendQr: vi.fn(), claimFriendQr: vi.fn(async () => { throw Error('private detail'); }) });
    await act(async () => renderer.root.findByType('CameraView' as any).props.onBarcodeScanned({ data: 'qingmu://friend/add?token=error' }));
    expect(alerts(renderer)).toContain('請稍後再試');
    expect(alerts(renderer)).not.toContain('過期');
    expect(alerts(renderer)).not.toContain('private detail');
  });
  it('reports a camera mount failure and reuses the existing open-camera action to retry', async () => {
    const client = { createFriendQr: vi.fn(), claimFriendQr: vi.fn() };
    const renderer = await scanner(client);
    await act(async () => { renderer.root.findByType('CameraView' as any).props.onMountError({ message: 'native details' }); });
    expect(alerts(renderer)).toContain('相機無法開啟');
    expect(alerts(renderer)).not.toContain('native details');
    await act(async () => { renderer.root.findAll((node) => String(node.type) === 'Pressable')[0].props.onPress(); });
    expect(renderer.root.findAllByType('CameraView' as any)).toHaveLength(1);
    expect(alerts(renderer)).toBe('');
  });

  it('uses the native biometric prompt and accepts only its success result', async () => {
    const authenticate = createNativeAdminAuthenticator();
    await expect(authenticate()).resolves.toBe(true);
    expect(authenticateAsync).toHaveBeenCalledWith(expect.objectContaining({ promptMessage: '解鎖完整排名', cancelLabel: '取消' }));
    authenticateAsync.mockResolvedValueOnce({ success: false });
    await expect(authenticate()).resolves.toBe(false);
  });
});
