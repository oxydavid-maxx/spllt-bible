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
/**
 * 讀經 (維護者 2026-10-14, K1; 詩 119:130「你的言語一解開，就發出亮光」): a closed Bible with a
 * cross until the day's reading is done, then the Bible lies open and gives light, the way the 靈修
 * leaf grows a new leaf.
 */
export function BookGlyph({ completed, size = completed ? 28 : 24, color = completed ? theme.colors.white : theme.colors.primary }: { completed: boolean; size?: number; color?: string }) {
  return completed
    ? <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M2 12h6a4 4 0 0 1 4 4v6a3 3 0 0 0-3-3H2z" /><Path d="M22 12h-6a4 4 0 0 0-4 4v6a3 3 0 0 1 3-3h7z" />
      <Path d="M12 2v4" /><Path d="M6.3 4.3l2.2 2.6" /><Path d="M17.7 4.3l-2.2 2.6" /><Path d="M3 9l2.8 1" /><Path d="M21 9l-2.8 1" />
    </Svg>
    : <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><Path d="M8 3v18" /><Path d="M14 7.5v8" /><Path d="M11 10.5h6" />
    </Svg>;
}
