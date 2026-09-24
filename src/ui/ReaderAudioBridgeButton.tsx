import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { requestReaderAudioToggle, useReaderAudioSnapshot } from '../services/readerAudioBridge';
import { theme } from './Theme';

/** A remote command for the Reader-owned player. This component never creates an audio player. */
export function ReaderAudioBridgeButton() {
  const audio = useReaderAudioSnapshot();
  const disabled = audio.state === 'inactive' || audio.state === 'loading' || audio.state === 'unavailable';
  const label = audio.state === 'playing' ? '暫停朗讀'
    : audio.state === 'retry' ? '重試朗讀'
      : audio.state === 'loading' ? '朗讀載入中'
        : audio.state === 'unavailable' ? '本章沒有朗讀' : '播放朗讀';
  const icon = audio.state === 'playing' ? 'pause'
    : audio.state === 'retry' ? 'replay'
      : audio.state === 'unavailable' ? 'volume-off' : 'play';
  return <View accessibilityLabel="日記朗讀控制" accessible={false} style={styles.host}>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={audio.chapterUsfm ? `目前章節${audio.chapterUsfm}` : undefined}
      accessibilityState={{ disabled, busy: audio.state === 'loading' }}
      disabled={disabled}
      onPress={requestReaderAudioToggle}
      android_ripple={{ color: theme.colors.primarySoft }}
      style={[styles.button, disabled && styles.disabled]}
    >
      {audio.state === 'loading'
        ? <ActivityIndicator accessibilityLabel="朗讀載入中" color={theme.colors.white} />
        : <MaterialCommunityIcons name={icon} size={22} color={theme.colors.white} />}
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  host: { width: 48, height: 48, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  button: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primary },
  disabled: { opacity: 0.5 },
});
