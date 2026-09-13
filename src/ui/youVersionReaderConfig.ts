export interface YouVersionReaderConfig {
  references: string[];
  versionId: number;
  appKey: string;
  allowTechnicalProbe: boolean;
}

export function buildYouVersionReaderConfig(config: YouVersionReaderConfig) {
  const first = config.references[0]?.match(/^([A-Z0-9]+)\.(\d+)/);
  if (!first) throw new Error('YouVersion reader requires a Bible chapter reference');
  return {
    book: first[1],
    chapter: first[2],
    versionId: config.versionId,
    references: config.references,
    allowTechnicalProbe: config.allowTechnicalProbe,
  };
}
