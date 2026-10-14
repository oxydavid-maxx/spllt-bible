import Svg, { Path, Rect } from 'react-native-svg';
import { theme } from '../Theme';

/** The 靈修 leaf, the tick and the play/pause marks drawn as in the 2026-10-14 mock. */

export function LeafGlyph({ size = 24, color = theme.colors.primary }: { size?: number; color?: string }) {
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

export function GrownLeafGlyph({ size = 28, color = theme.colors.white }: { size?: number; color?: string }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M9 16c0-6 4.5-10.5 11-10.5 0 6.5-4.5 10.5-11 10.5z" /><Path d="M9 16l6-6" /><Path d="M9 16c-3.6 0-6-2.2-6-5.6 3.6 0 6 2.2 6 5.6z" /><Path d="M9 16v5" />
  </Svg>;
}
export function BookGlyph({ completed, size = completed ? 26 : 24, color = completed ? theme.colors.white : theme.colors.primary }: { completed: boolean; size?: number; color?: string }) {
  return completed
    ? <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}><Path d="M18 22a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h-6v7l-2.5-1.5L7 9V2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12z" /></Svg>
    : <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><Path d="M2 5h6a4 4 0 0 1 4 4v11a3 3 0 0 0-3-3H2z" /><Path d="M22 5h-6a4 4 0 0 0-4 4v11a3 3 0 0 1 3-3h7z" /></Svg>;
}
