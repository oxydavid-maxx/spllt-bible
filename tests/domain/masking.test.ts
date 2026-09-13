import { describe, expect, it } from 'vitest';
import { maskForViewer } from '../../src/domain/masking';

describe('member masking', () => {
  const member = { id: 'google:other', displayName: '王小明' };

  it('returns the viewer own name and an O-name for others', () => {
    expect(maskForViewer('google:other', member)).toEqual({
      id: 'google:other',
      label: '王小明',
      isSelf: true,
    });
    expect(maskForViewer('google:self', member)).toEqual({
      id: 'google:other',
      label: 'O小O',
      isSelf: false,
    });
    expect(JSON.stringify(maskForViewer('google:self', member))).not.toContain('王小明');
  });
});
