import type { ContentGateStatus } from '../domain/types';

export interface ReaderTask {
  date: string;
  references: string[];
}

export interface ReaderState {
  mode: 'pending' | 'c-probe' | 'c-native' | 'b-external';
  references: string[];
  message: string;
  externalUrl?: string;
  releaseReady?: boolean;
}

export function createReaderAdapter(options: { externalBaseUrl?: string; allowTechnicalProbe?: boolean } = {}) {
  return {
    async open(task: ReaderTask, gate: ContentGateStatus): Promise<ReaderState> {
      if (gate === 'C_READY') {
        return {
          mode: 'c-native',
          references: task.references,
          message: '已核准的App內經文內容可供閱讀',
        };
      }
      if (gate === 'C_TECHNICAL_PROBE' && options.allowTechnicalProbe) {
        return {
          mode: 'c-probe',
          references: task.references,
          message: '已核准的測試素材可作原生探測；探測完成前仍不可視為正式可交付',
          releaseReady: false,
        };
      }
      if (gate === 'C_NOT_AVAILABLE') {
        return {
          mode: 'b-external',
          references: task.references,
          message: '內容供應者已明確無法交付，等待核准的外部閱讀方式',
          externalUrl: options.externalBaseUrl
            ? `${options.externalBaseUrl}?reference=${encodeURIComponent(task.references.join(','))}`
            : undefined,
        };
      }
      return {
        mode: 'pending',
        references: task.references,
        message: '中文內容/音訊授權仍待核對，暫不自動切換外部閱讀',
      };
    },
  };
}
