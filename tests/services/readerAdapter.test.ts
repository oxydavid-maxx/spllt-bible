import { describe, expect, it } from 'vitest';
import { createReaderAdapter } from '../../src/services/readerAdapter';

describe('reader adapter gate', () => {
  const task = { date: '2026-09-08', references: ['JHN.18', 'JHN.19'] };

  it('does not open external YouVersion while C is pending', async () => {
    const result = await createReaderAdapter().open(task, 'C_PENDING_ACCESS');
    expect(result).toMatchObject({ mode: 'pending', references: task.references });
    expect(result.externalUrl).toBeUndefined();
  });

  it('uses native C only when the gate is ready and B only when explicitly unavailable', async () => {
    await expect(createReaderAdapter().open(task, 'C_READY')).resolves.toMatchObject({ mode: 'c-native' });
    await expect(createReaderAdapter().open(task, 'C_NOT_AVAILABLE')).resolves.toMatchObject({ mode: 'b-external' });
  });

  it('opens an explicit approved probe without presenting it as release-ready C', async () => {
    await expect(createReaderAdapter({ allowTechnicalProbe: true }).open(task, 'C_TECHNICAL_PROBE')).resolves.toMatchObject({
      mode: 'c-probe',
      releaseReady: false,
    });
    await expect(createReaderAdapter().open(task, 'C_TECHNICAL_PROBE')).resolves.toMatchObject({ mode: 'pending' });
  });
});
