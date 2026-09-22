import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFolderHtml, fetchWorkbook } from '../../tools/announce/fetch';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('announcement fetch outcome boundary', () => {
  it('preserves an HTTP-success empty body instead of reporting a source failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('')));
    expect(await fetchFolderHtml('test-folder')).toBe('');
    expect(await fetchWorkbook('test-workbook')).toEqual(Buffer.alloc(0));
  });

  it('reports HTTP failure and disconnected transport as null', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response('unavailable', { status: 503 })).mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', request);
    expect(await fetchFolderHtml('test-folder')).toBeNull();
    expect(await fetchWorkbook('test-workbook')).toBeNull();
  });

  it('reports a timed-out source as null and releases the deadline', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })));
    const pending = fetchFolderHtml('test-folder');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await pending).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
