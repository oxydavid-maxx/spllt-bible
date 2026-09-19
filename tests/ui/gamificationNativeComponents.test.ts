import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const { primitive, requestPermission, authenticateAsync } = vi.hoisted(() => ({ primitive: (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children), requestPermission: vi.fn(async () => ({ granted: true, status: 'granted' })), authenticateAsync: vi.fn(async () => ({ success: true })) }));
vi.mock('react-native', () => ({ ActivityIndicator: primitive('ActivityIndicator'), Pressable: primitive('Pressable'), Text: primitive('Text'), TextInput: primitive('TextInput'), View: primitive('View'), StyleSheet: { create: (value: unknown) => value } }));
vi.mock('expo-camera', () => ({ CameraView: (props: any) => React.createElement('CameraView', props), useCameraPermissions: () => [{ granted: false, status: 'undetermined' }, requestPermission] }));
vi.mock('react-native-qrcode-svg', () => ({ default: (props: any) => React.createElement('QRCode', props) }));
vi.mock('expo-local-authentication', () => ({ authenticateAsync }));

import { FriendQrPanel } from '../../src/ui/gamification/FriendQrPanel';
import { createNativeAdminAuthenticator } from '../../src/services/adminUnlockGuard';

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

  it('uses the native biometric prompt and accepts only its success result', async () => {
    const authenticate = createNativeAdminAuthenticator();
    await expect(authenticate()).resolves.toBe(true);
    expect(authenticateAsync).toHaveBeenCalledWith(expect.objectContaining({ promptMessage: '解鎖完整排名', cancelLabel: '取消' }));
    authenticateAsync.mockResolvedValueOnce({ success: false });
    await expect(authenticate()).resolves.toBe(false);
  });
});
