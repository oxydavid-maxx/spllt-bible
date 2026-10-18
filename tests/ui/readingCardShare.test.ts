import { beforeEach, describe, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ print: vi.fn(), available: vi.fn(), share: vi.fn() }));
vi.mock('expo-print', () => ({ printToFileAsync: native.print }));
vi.mock('expo-sharing', () => ({ isAvailableAsync: native.available, shareAsync: native.share }));
import { shareReadingCard } from '../../src/ui/readingCardShare';

beforeEach(() => { native.available.mockResolvedValue(true); native.print.mockResolvedValue({ uri: 'file:///cache/card.pdf', numberOfPages: 1 }); native.share.mockResolvedValue(undefined); });
describe('native PDF sharing on both platforms', () => {
  it('generates A4 with the supplied HTML and opens the system PDF share sheet', async () => {
    await shareReadingCard('<!DOCTYPE html><html>fixture</html>');
    expect(native.print).toHaveBeenCalledWith({ html: '<!DOCTYPE html><html>fixture</html>', width: 595, height: 842, margins: { top: 0, bottom: 0, left: 0, right: 0 }, textZoom: 100 });
    expect(native.share).toHaveBeenCalledWith('file:///cache/card.pdf', { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: '匯出讀經卡' });
  });
  it('reports unavailability and print failures so the user can retry', async () => {
    native.available.mockResolvedValue(false);
    await expect(shareReadingCard('html')).rejects.toThrow('這支手機目前無法開啟分享面板。');
    expect(native.print).not.toHaveBeenCalled();
    native.available.mockResolvedValue(true); native.print.mockRejectedValue(new Error('print failed'));
    await expect(shareReadingCard('html')).rejects.toThrow('print failed');
    expect(native.share).not.toHaveBeenCalled();
  });
});
