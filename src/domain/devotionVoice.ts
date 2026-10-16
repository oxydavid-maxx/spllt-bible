export const DEVOTION_VOICES = [
  { id: 'zh-TW-YunJheNeural', label: '男聲' },
  { id: 'zh-TW-HsiaoChenNeural', label: '女聲' },
] as const;
export type DevotionVoice = typeof DEVOTION_VOICES[number]['id'];
export const DEFAULT_DEVOTION_VOICE: DevotionVoice = 'zh-TW-YunJheNeural';
export function isDevotionVoice(value: unknown): value is DevotionVoice {
  return DEVOTION_VOICES.some(voice => voice.id === value);
}
