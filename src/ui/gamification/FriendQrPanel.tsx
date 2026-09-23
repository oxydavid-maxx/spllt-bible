import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import QRCode from 'react-native-qrcode-svg';
import { buildFriendQrPayload, parseFriendQrPayload } from '../../services/gamificationQr';
import { GamificationApiError, type FriendQr } from '../../services/gamificationApiClient';
import { theme } from '../Theme';

type Client = { createFriendQr: () => Promise<FriendQr>; claimFriendQr: (token: string, operationId?: string) => Promise<{ memberId: string }> };

function QrCode({ value }: { value: string }) {
  return <QRCode value={value} size={220} backgroundColor={theme.colors.surface} color={theme.colors.ink} />;
}

export function FriendQrPanel({ client, mode, onClaimed, onActivityStart }: { client: Client; mode: 'show' | 'scan'; onClaimed?: (memberId: string) => void; onActivityStart?: () => (() => boolean) }) {
  const [qr, setQr] = useState<FriendQr | null>(null); const [error, setError] = useState<string | null>(null); const [scanning, setScanning] = useState(false); const claimed = useRef(new Set<string>());
  const mounted = useRef(true);
  const owner = useRef({ client, mode });
  if (owner.current.client !== client || owner.current.mode !== mode) { owner.current = { client, mode }; claimed.current.clear(); }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const refresh = async () => { try { setError(null); setQr(await client.createFriendQr()); } catch { setError('目前無法產生好友碼，請稍後再試。'); } };
  useEffect(() => { if (mode === 'show') void refresh(); }, [mode]);
  useEffect(() => { if (mode !== 'show') return undefined; const timer = setInterval(() => { if (qr && qr.expiresAt - Date.now() < 60_000) void refresh(); }, 30_000); return () => clearInterval(timer); }, [mode, qr?.expiresAt]);
  const claim = async (value: string) => {
    const token = parseFriendQrPayload(value);
    if (!token) { setError('這不是青牧好友碼，請重新掃描。'); return; }
    if (claimed.current.has(token)) return;
    const requestOwner = owner.current;
    const current = () => mounted.current && owner.current === requestOwner;
    claimed.current.add(token); setError(null);
    let result: { memberId: string };
    try { result = await client.claimFriendQr(token); }
    catch (reason) {
      if (current()) { claimed.current.delete(token); setError(reason instanceof GamificationApiError ? reason.userMessage : '目前無法完成操作，請稍後再試。'); }
      return;
    }
    // A committed friendship remains committed; only stale UI navigation is discarded.
    if (current()) onClaimed?.(result.memberId);
  };
  if (mode === 'show') return <View style={styles.card}><Text style={styles.title}>我的好友 QR</Text>{qr ? <><QrCode value={buildFriendQrPayload(qr.token)} /><Text style={styles.expiry}>有效至 {new Date(qr.expiresAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}</Text></> : <ActivityIndicator color={theme.colors.primary} />}{error ? <Text style={styles.error}>{error}</Text> : null}<Pressable accessibilityRole="button" accessibilityLabel="重新產生好友 QR" onPress={() => void refresh()} style={styles.button}><Text style={styles.buttonText}>重新產生</Text></Pressable></View>;
  return <FriendScanner onScan={claim} scanning={scanning} setScanning={setScanning} error={error} onError={setError} onActivityStart={onActivityStart} />;
}

function FriendScanner({ onScan, scanning, setScanning, error, onError, onActivityStart }: { onScan: (value: string) => void; scanning: boolean; setScanning: (value: boolean) => void; error: string | null; onError: (error: string | null) => void; onActivityStart?: () => (() => boolean) }) {
  const [permission, requestPermission] = useCameraPermissions();
  const mounted = useRef(true);
  const requesting = useRef(false);
  const activity = useRef({ current: AppState.currentState === 'active', pending: null as null | { kind: 'scan'; data: string } | { kind: 'cancel' | 'error' } });
  const run = useRef(0);
  const scannerCleanup = useRef<(() => boolean) | null>(null);
  const [wake, setWake] = useState(0);
  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', (next) => { activity.current.current = next === 'active'; setWake((value) => value + 1); });
    return () => { mounted.current = false; run.current += 1; scannerCleanup.current?.(); scannerCleanup.current = null; subscription.remove(); };
  }, []);
  useEffect(() => {
    if (!activity.current.current || !activity.current.pending || !mounted.current) return;
    const outcome = activity.current.pending;
    activity.current.pending = null;
    const finish = scannerCleanup.current;
    scannerCleanup.current = null;
    const current = finish?.() ?? true;
    setScanning(false);
    if (!current || !mounted.current) return;
    if (outcome.kind === 'scan') onScan(outcome.data);
    else if (outcome.kind === 'error') onError('相機無法開啟，請再試一次。');
  }, [wake, onScan, onError, setScanning]);
  const open = async () => {
    if (requesting.current) return;
    onError(null);
    if (Platform.OS === 'android') {
      if (!CameraView.isModernBarcodeScannerAvailable) { onError('相機無法開啟，請再試一次。'); return; }
      requesting.current = true;
      setScanning(true);
      const id = ++run.current;
      const finishActivity = onActivityStart?.();
      const subscription = CameraView.onModernBarcodeScanned((event) => {
        if (!mounted.current || run.current !== id || activity.current.pending || !event.data) return;
        activity.current.pending = { kind: 'scan', data: event.data };
        setWake((value) => value + 1);
      });
      scannerCleanup.current = () => { run.current += 1; subscription.remove(); requesting.current = false; return finishActivity?.() ?? true; };
      try { await CameraView.launchScanner({ barcodeTypes: ['qr'] }); }
      catch (reason) {
        if (!mounted.current || run.current !== id || activity.current.pending) return;
        activity.current.pending = { kind: reason instanceof Error && /cancel/i.test(reason.message) ? 'cancel' : 'error' };
        setWake((value) => value + 1);
      }
      return;
    }
    if (permission?.granted) { setScanning(true); return; }
    requesting.current = true;
    let finish = onActivityStart?.();
    try {
      const result = await requestPermission();
      const current = finish?.() ?? true; finish = undefined;
      if (mounted.current && current && result.granted) setScanning(true);
    } catch { /* permission remains denied/unknown */ }
    finally { finish?.(); requesting.current = false; }
  };
  if (!scanning) return <View style={styles.card}><Text style={styles.title}>掃描好友 QR</Text>{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}{Platform.OS !== 'android' && permission?.granted === false ? <Text style={styles.error}>需要相機權限才能掃描好友碼。</Text> : null}<Pressable accessibilityRole="button" accessibilityLabel="開啟相機掃描好友碼" onPress={() => void open()} style={styles.button}><Text style={styles.buttonText}>開啟相機</Text></Pressable></View>;
  if (Platform.OS === 'android') return <View style={styles.card}><ActivityIndicator color={theme.colors.primary} /></View>;
  return <View style={styles.camera}><CameraView style={{ flex: 1 }} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={(event) => { if (event.data) { setScanning(false); onScan(event.data); } }} onMountError={() => { onError('相機無法開啟，請再試一次。'); setScanning(false); }} /></View>;
}

const styles = StyleSheet.create({ card: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: theme.control.hairline, borderRadius: theme.radius.card, padding: theme.spacing.lg, alignItems: 'center', gap: theme.spacing.sm }, title: { color: theme.colors.ink, fontSize: theme.type.heading.size, fontWeight: '800' }, payload: { color: theme.colors.muted, fontSize: theme.type.micro.size, textAlign: 'center', maxWidth: 240 }, expiry: { color: theme.colors.muted, fontSize: theme.type.caption.size }, error: { color: theme.colors.accent, fontSize: theme.type.caption.size, textAlign: 'center' }, button: { minHeight: theme.control.tap, minWidth: 160, paddingHorizontal: theme.spacing.lg, borderRadius: theme.radius.button, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' }, buttonText: { color: theme.colors.white, fontSize: theme.type.body.size, fontWeight: '800' }, camera: { height: 320, overflow: 'hidden', borderRadius: theme.radius.card, backgroundColor: theme.colors.ink } });
