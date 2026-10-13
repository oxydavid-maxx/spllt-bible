import { describe, expect, it, vi } from 'vitest';
import { classificationPrompt, parseClassification, fileText, type ClassificationInput } from '../../tools/announce/classify';
import { readFileSync } from 'node:fs';

const io = vi.hoisted(() => ({ fetchDriveFile: vi.fn(), fetchSlidesText: vi.fn(), fetchDocText: vi.fn() }));
vi.mock('../../tools/announce/fetch', () => io);
const input: ClassificationInput = { week: '2026-10-11', sessions: [
  { label: '第一堂', title: '十架：耶穌為什麼死？', owner: '中亮/大專' },
  { label: '第二堂', title: '青少團契', owner: null, context: '讀書會/拖延症' },
], files: [{ id: 'deck', name: '任意檔名.pptx', content: '青崇讀書會 一本書終結 你的拖延症' }] };

describe('the bounded classification response', () => {
  it('accepts the real recorded second-session decision independently of the filename', () => {
    expect(parseClassification('{"files":[{"id":"deck","session":2,"role":"sermonSlides"}]}', input).files[0].session).toBe(2);
    expect(classificationPrompt(input)).toContain('一本書終結');
    expect(classificationPrompt(input)).toContain('十架');
  });
  it.each([
    '{"files":[]}',
    '{"files":[{"id":"missing","session":2,"role":"sermonSlides"}]}',
    '{"files":[{"id":"deck","session":3,"role":"sermonSlides"}]}',
    '{"files":[{"id":"deck","session":2,"role":"invented"}]}',
    '{"files":[{"id":"deck","session":2,"role":"sermonSlides"},{"id":"deck","session":2,"role":"sermonSlides"}]}',
  ])('rejects malformed/foreign/duplicate assignments: %s', raw => expect(() => parseClassification(raw, input)).toThrow());
  it('drops invented titles and speakers while keeping a valid file assignment', () => {
    expect(parseClassification('{"files":[{"id":"deck","session":2,"role":"sermonSlides","title":"未出現在內容的標題","speaker":"未核實講員"}]}', input).files[0])
      .toMatchObject({ session: 2, title: null, speaker: null });
  });
  it('reads the captured title slide even after a file is renamed', async () => {
    io.fetchDriveFile.mockResolvedValue(readFileSync('tests/fixtures/announce-20261011-title.pptx'));
    expect(await fileText({ id: 'deck', name: '任意檔名.pptx' })).toContain('一本書終結');
  });
  it('returns unknown content on transport/ZIP failure so classification can fall back', async () => {
    io.fetchDriveFile.mockResolvedValue(null);
    expect(await fileText({ id: 'deck', name: '任意檔名.pptx' })).toBeNull();
    io.fetchDriveFile.mockResolvedValue(Buffer.from('not a ZIP'));
    expect(await fileText({ id: 'deck', name: '任意檔名.pptx' })).toBe('');
  });
});
