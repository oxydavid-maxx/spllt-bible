import { describe, expect, it } from 'vitest';
import { verifyCandidate } from '../scripts/verify-candidate';

describe('candidate boundary', () => {
  it('accepts the fixture-marked Android package without secrets', async () => {
    const receipt = await verifyCandidate(process.cwd());
    expect(receipt.androidPackage).toBe('org.qingmu.youth');
    expect(receipt.fixture).toBe(true);
    expect(receipt.contentMode).toBe('C_PENDING_ACCESS');
    expect(receipt.forbiddenMatches).toEqual([]);
  });
});
