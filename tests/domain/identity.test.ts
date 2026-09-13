import { describe, expect, it } from 'vitest';
import { memberKey } from '../../src/domain/identity';

describe('identity keys', () => {
  it('uses provider and subject instead of display names', () => {
    expect(memberKey('google', 'sub-123')).toBe('google:sub-123');
    expect(memberKey('google', 'sub-123')).not.toBe(memberKey('google', '小明'));
    expect(memberKey('google', 'sub-123')).not.toBe(memberKey('line', 'sub-123'));
  });
});
