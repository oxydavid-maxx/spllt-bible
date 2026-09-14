import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import QRCode from 'react-native-qrcode-svg';
import { buildFriendQrPayload, parseFriendQrPayload } from '../../services/gamificationQr';
import type { FriendQr } from '../../services/gamificationApiClient';
import { theme } from '../Theme';

type Client = { createFriendQr: () => Promise<FriendQr>; claimFriendQr: (token: string, operationId?: string) => Promise<{ memberId: string }> };

function QrCode({ value }: { value: string }) {
  return <QRCode value={value} size={220} backgroundColor={theme.colors.surface} color={theme.colors.ink} />;
}

export function FriendQrPanel({ client, mode, onClaimed }: { client: Client; mode: 'show' | 'scan'; onClaimed?: (memberId: string) => void }) {
  const [qr, setQr] = useState<FriendQr | null>(null); const [error, setError] = useState<string | null>(null); const [scanning, setScanning] = useState(false); const claimed = useRef(new Set<string>());
  const refresh = async () => { try { setError(null); setQr(await client.createFriendQr()); } catch { setError('目前無法產生好友碼，請稍後再試。'); } };
  useEffect(() => { if (mode === 'show') void refresh(); }, [mode]);
  useEffect(() => { if (mode !== 'show') return undefined; const timer = setInterval(() => { if (qr && qr.expiresAt - Date.now() < 60_000) void refresh(); }, 30_000); return () => clearInterval(timer); }, [mode, qr?.expiresAt]);
  const claim = async (value: string) => { const token = parseFriendQrPayload(value); if (!token || claimed.current.has(token)) return; claimed.current.add(token); try { const result = await client.claimFriendQr(token); onClaimed?.(result.memberId); } catch { claimed.current.delete(token); setError('好友碼無效或已過期。'); } };
  if (mode === 'show') return <View style={styles.card}><Text style={styles.title}>我的好友 QR</Text>{qr ? <><QrCode value={buildFriendQrPayload(qr.token)} /><Text style={styles.expiry}>有效至 {new Date(qr.expiresAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}</Text></> : <ActivityIndicator color={theme.colors.primary} />}{error ? <Text style={styles.error}>{error}</Text> : null}<Pressable accessibilityRole="button" accessibilityLabel="重新產生好友 QR" onPress={() => void refresh()} style={styles.button}><Text style={styles.buttonText}>重新產生</Text></Pressable></View>;
  return <FriendScanner onScan={claim} scanning={scanning} setScanning={setScanning} error={error} />;
}

function FriendScanner({ onScan, scanning, setScanning, error }: { onScan: (value: string) => void; scanning: boolean; setScanning: (value: boolean) => void; error: string | null }) {
  const [permission, requestPermission] = useCameraPermissions();
  const open = async () => { try { const result = await requestPermission(); if (!result.granted) return; setScanning(true); } catch { /* permission remains denied/unknown */ } };
  if (!scanning) return <View style={styles.card}><Text style={styles.title}>掃描好友 QR</Text>{permission?.granted === false ? <Text style={styles.error}>需要相機權限才能掃描好友碼。</Text> : null}<Pressable accessibilityRole="button" accessibilityLabel="開啟相機掃描好友碼" onPress={() => void open()} style={styles.button}><Text style={styles.buttonText}>開啟相機</Text></Pressable></View>;
  return <View style={styles.camera}><CameraView barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={(event) => { if (event.data) { setScanning(false); onScan(event.data); } }} onMountError={() => setScanning(false)} /></View>;
}

const styles = StyleSheet.create({ card: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: theme.control.hairline, borderRadius: theme.radius.card, padding: theme.spacing.lg, alignItems: 'center', gap: theme.spacing.sm }, title: { color: theme.colors.ink, fontSize: theme.type.heading.size, fontWeight: '800' }, payload: { color: theme.colors.muted, fontSize: theme.type.micro.size, textAlign: 'center', maxWidth: 240 }, expiry: { color: theme.colors.muted, fontSize: theme.type.caption.size }, error: { color: theme.colors.accent, fontSize: theme.type.caption.size, textAlign: 'center' }, button: { minHeight: theme.control.tap, minWidth: 160, paddingHorizontal: theme.spacing.lg, borderRadius: theme.radius.button, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' }, buttonText: { color: theme.colors.white, fontSize: theme.type.body.size, fontWeight: '800' }, camera: { height: 320, overflow: 'hidden', borderRadius: theme.radius.card, backgroundColor: theme.colors.ink } });
