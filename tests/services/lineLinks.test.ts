import { describe, expect, it } from 'vitest';
import { createLineLinks } from '../../src/services/lineLinks';

describe('LINE OpenChat/RPG entrance', () => {
  it('returns a fixed OpenChat entrance and an optional external call link without private member data', () => {
    const links = createLineLinks({
      communityUrl: 'https://openchat.line.me/c/example',
      groups: {
        A: {
          rpgUrl: 'https://openchat.line.me/c/rpg-a',
          callUrl: 'https://meet.google.com/example-a',
          callProvider: 'meet',
        },
      },
    }).forMember({ id: 'google:self', groupId: 'A', displayName: '小明' });

    expect(links).toEqual({
      communityUrl: 'https://openchat.line.me/c/example',
      rpgUrl: 'https://openchat.line.me/c/rpg-a',
      callUrl: 'https://meet.google.com/example-a',
      callProvider: 'meet',
    });
    expect(JSON.stringify(links)).not.toContain('google:self');
    expect(JSON.stringify(links)).not.toContain('小明');
  });
});
