import { describe, expect, it } from 'vitest';

import { buildGroupLinkFallback } from '../../src/ui/groupLinkFallback';

describe('RPG provider link recovery', () => {
  it('returns copy and group-LINE recovery targets after a provider handoff fails', () => {
    expect(buildGroupLinkFallback('https://meet.google.com/room', 'https://line.me/ti/g2/group')).toEqual({ copyUrl: 'https://meet.google.com/room', returnToGroupUrl: 'https://line.me/ti/g2/group' });
    expect(buildGroupLinkFallback('https://line.me/ti/g2/group', 'https://line.me/ti/g2/group').returnToGroupUrl).toBeNull();
  });
});
