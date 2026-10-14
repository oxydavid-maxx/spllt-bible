import Svg, { Path, Rect } from 'react-native-svg';
import { theme } from '../Theme';

/** The 靈修 leaf, the tick and the play/pause marks drawn as in the 2026-10-14 mock. */

export function LeafGlyph({ size = 24, color = theme.colors.gold }: { size?: number; color?: string }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M5 19c0-8 6-14 14-14 0 8-6 14-14 14z" /><Path d="M5 19l8-8" />
  </Svg>;
}

export function TickGlyph({ size = 26, color = theme.colors.white }: { size?: number; color?: string }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><Path d="M5 12l5 5 9-10" /></Svg>;
}

export function PlayPauseGlyph({ playing, size = 22 }: { playing: boolean; size?: number }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24">{playing
    ? <><Rect x={6} y={5} width={4} height={14} rx={1} fill={theme.colors.white} /><Rect x={14} y={5} width={4} height={14} rx={1} fill={theme.colors.white} /></>
    : <Path d="M7 4v16l13-8z" fill={theme.colors.white} />}</Svg>;
}
