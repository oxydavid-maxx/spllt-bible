import { getAudioAvailability, getYouVersionContentMetadata } from '../config/youVersionContent';

/**
 * Review 121 C10. The audio line was derived from a STATIC PENDING_PROVIDER constant, so it kept
 * telling 使用者 we were 等待Biblica授權 long after the source question was settled and after the App
 * had a real per-chapter capability path. The live state is now an input: when the caller knows the
 * current chapter's state it is reported, and only a genuinely unknown state falls back to the
 * version-level metadata. Attribution is unchanged - the publisher and edition are still named.
 */
export type ChapterAudioLiveState = 'playable' | 'pending' | 'unavailable' | 'no-audio' | 'unknown';

function audioLineFor(state: ChapterAudioLiveState): string | null {
  switch (state) {
    case 'playable': return '中文音訊：這一章可以朗讀';
    case 'pending': return '中文音訊：這一章的朗讀還沒取得';
    case 'unavailable': return '中文音訊：暫時無法取得，稍後可再試';
    case 'no-audio': return '中文音訊：這一章沒有朗讀';
    default: return null;
  }
}

export function buildContentPresentation(versionId: number | null, audioState: ChapterAudioLiveState = 'unknown') {
  const metadata = getYouVersionContentMetadata(versionId);
  if (!metadata) {
    return {
      title: '讀經內容準備中',
      body: '讀經會使用核准的YouVersion內容；目前尚未接入其他經文來源。',
      sourceLabel: 'YouVersion內容準備中',
      audioLabel: '中文音訊狀態：尚未核准版本',
      audioAvailability: null,
      technicalProbe: false,
    };
  }
  return {
    title: '經文文字已可讀',
    body: `YouVersion ${metadata.translationName}／${metadata.publisher}。今天的經文可在官方閱讀器閱讀。`,
    sourceLabel: `${metadata.translationName}／${metadata.publisher}`,
    audioLabel: audioLineFor(audioState)
      ?? `中文音訊狀態：${metadata.audioAvailability.status === 'PENDING_PROVIDER' ? `依這一章的實際來源而定（${metadata.publisher}）` : metadata.audioAvailability.status}`,
    audioAvailability: getAudioAvailability(versionId),
    technicalProbe: true,
  };
}
