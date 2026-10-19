import { beforeEach, describe, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ print: vi.fn(), available: vi.fn(), share: vi.fn(), move: vi.fn() }));
vi.mock('expo-print', () => ({ printToFileAsync: native.print }));
vi.mock('expo-sharing', () => ({ isAvailableAsync: native.available, shareAsync: native.share }));
vi.mock('expo-file-system', () => {
  class File {
    uri: string;
    constructor(...parts: Array<string | { uri: string }>) { this.uri = parts.map(part => typeof part === 'string' ? part : part.uri).join(''); }
    moveSync(target: File, options?: { overwrite?: boolean }) { native.move(this.uri, target.uri, options); this.uri = target.uri; }
  }
  return { File, Paths: { cache: { uri: 'file:///cache/' } } };
});
import { shareReadingCard } from '../../src/ui/readingCardShare';

beforeEach(() => {
  native.available.mockResolvedValue(true); native.print.mockResolvedValue({ uri: 'file:///cache/Print/0c1d.pdf', numberOfPages: 1 });
  native.share.mockResolvedValue(undefined); native.move.mockReset();
});
describe('native PDF sharing on both platforms', () => {
  it('generates A4 with the supplied HTML and opens the system PDF share sheet under the card name', async () => {
    await shareReadingCard('<!DOCTYPE html><html>fixture</html>', '讀經卡-王小明-202610.pdf');
    expect(native.print).toHaveBeenCalledWith({ html: '<!DOCTYPE html><html>fixture</html>', width: 595, height: 842, margins: { top: 0, bottom: 0, left: 0, right: 0 }, textZoom: 100 });
    expect(native.move).toHaveBeenCalledWith('file:///cache/Print/0c1d.pdf', 'file:///cache/讀經卡-王小明-202610.pdf', { overwrite: true });
    expect(native.share).toHaveBeenCalledWith('file:///cache/讀經卡-王小明-202610.pdf', { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: '匯出讀經卡' });
  });
  it('still shares the printed file when renaming fails, because the name is only a convenience', async () => {
    native.move.mockImplementation(() => { throw new Error('rename failed'); });
    await shareReadingCard('html', '讀經卡-202610.pdf');
    expect(native.share).toHaveBeenCalledWith('file:///cache/Print/0c1d.pdf', expect.objectContaining({ mimeType: 'application/pdf' }));
  });
  it('reports unavailability and print failures so the user can retry', async () => {
    native.available.mockResolvedValue(false);
    await expect(shareReadingCard('html', 'a.pdf')).rejects.toThrow('這支手機目前無法開啟分享面板。');
    expect(native.print).not.toHaveBeenCalled();
    native.available.mockResolvedValue(true); native.print.mockRejectedValue(new Error('print failed'));
    await expect(shareReadingCard('html', 'a.pdf')).rejects.toThrow('print failed');
    expect(native.share).not.toHaveBeenCalled();
  });
});
