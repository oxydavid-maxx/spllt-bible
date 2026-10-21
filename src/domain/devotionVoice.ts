export const DEVOTION_VOICES = [
  { id: 'zh-TW-YunJheNeural', label: '男聲' },
  { id: 'zh-TW-HsiaoChenNeural', label: '女聲' },
] as const;
export type DevotionVoice = typeof DEVOTION_VOICES[number]['id'];
export const DEFAULT_DEVOTION_VOICE: DevotionVoice = 'zh-TW-YunJheNeural';
export function isDevotionVoice(value: unknown): value is DevotionVoice {
  return DEVOTION_VOICES.some(voice => voice.id === value);
}

/**
 * Integrated loudness (LUFS, EBU R128) measured 2026-10-21 with ffmpeg's ebur128 on the backend's Azure mp3s for
 * 10/20–10/21 (six paragraphs per voice, each within 0.2 LU) and on the published chapter recordings (徒 1, 詩 124).
 */
const VOICE_LOUDNESS: Record<DevotionVoice, number> = { 'zh-TW-YunJheNeural': -22.9, 'zh-TW-HsiaoChenNeural': -18.9 };
const BIBLE_AUDIO_LOUDNESS: Record<number, number> = { 46: -29.7, 40: -19.4, 111: -16.6, 114: -17.1 };

/**
 * The 靈修 plays at the loudness of the scripture just heard (維護者 2026-10-21: after the 和合本 chapters the
 * 靈修 was clearly louder). A player can only turn a sound down, so a version louder than the voice leaves it at
 * full volume, and a version without a measured recording changes nothing.
 */
export function devotionVolume(voice: DevotionVoice, bibleVersionId: number | null | undefined): number {
  const bible = bibleVersionId == null ? undefined : BIBLE_AUDIO_LOUDNESS[bibleVersionId];
  if (bible === undefined) return 1;
  return Math.min(1, Math.round(10 ** ((bible - VOICE_LOUDNESS[voice]) / 20) * 100) / 100);
}
