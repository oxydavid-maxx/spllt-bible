import { describe, expect, it } from 'vitest';
import { createYouVersionAdapter } from '../../src/services/youVersionAdapter';

describe('YouVersion adapter loading', () => {
  it('does not load the native SDK without an App Key', async () => {
    let loaded = false;
    const result = await createYouVersionAdapter({ appKey: null, moduleLoader: async () => { loaded = true; return {}; } }).load();
    expect(result.status).toBe('CONFIG_REQUIRED');
    expect(loaded).toBe(false);
  });

  it('uses the injected native module seam only after App Key configuration', async () => {
    const result = await createYouVersionAdapter({ appKey: 'fixture-key', moduleLoader: async () => ({ BibleReader: 'native' }) }).load();
    expect(result).toMatchObject({ status: 'NATIVE_MODULE_READY' });
  });

  it('keeps the product reader on the official SDK UI seam', async () => {
    const result = await createYouVersionAdapter({ appKey: 'fixture-key', readerModuleLoader: async () => ({ BibleReader: 'official' }) }).loadReaderUi();
    expect(result).toMatchObject({ status: 'READER_UI_READY' });
    await expect(createYouVersionAdapter({}).loadReaderUi()).resolves.toMatchObject({ status: 'CONFIG_REQUIRED' });
  });
});
