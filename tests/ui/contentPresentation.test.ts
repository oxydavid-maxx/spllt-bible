import { describe, expect, it } from 'vitest';

import { buildContentPresentation } from '../../src/ui/contentPresentation';

describe('content and audio presentation', () => {
  it('states publisher-specific pending audio without offering a substitute', () => {
    expect(buildContentPresentation(1392)).toMatchObject({ audioAvailability: { status: 'PENDING_PROVIDER', publisher: 'Biblica', versionId: 1392 }, technicalProbe: true });
    expect(buildContentPresentation(1392).audioLabel).toContain('Biblica');
    expect(buildContentPresentation(312).audioLabel).toContain('全球聖經促進會');
    expect(buildContentPresentation(312).audioLabel).not.toContain('Biblica');
    expect(buildContentPresentation(null)).toMatchObject({ audioAvailability: null, technicalProbe: false });
  });
});
