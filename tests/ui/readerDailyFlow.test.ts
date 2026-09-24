import { describe, expect, it } from 'vitest';
import { buildReaderDomBridge, readReaderCanvasScrollEvent, readReaderUiMessage, READER_CANVAS_SCROLL_MESSAGE } from '../../src/ui/readerSettingsBridge';
import * as readerConfig from '../../src/ui/youVersionReaderConfig';

describe('Reader daily flow contracts', () => {
  it('preserves scroll direction and measured distance across the DOM bridge', () => {
    const down = JSON.stringify({ type: READER_CANVAS_SCROLL_MESSAGE, data: { direction: 'down', deltaY: 20 } });
    const up = JSON.stringify({ type: READER_CANVAS_SCROLL_MESSAGE, data: { direction: 'up', deltaY: -20 } });
    const jitter = JSON.stringify({ type: READER_CANVAS_SCROLL_MESSAGE, data: { direction: 'down', deltaY: 6 } });
    const invalidDirection = JSON.stringify({ type: READER_CANVAS_SCROLL_MESSAGE, data: { direction: 'down', deltaY: -20 } });

    expect(readReaderUiMessage(down)).toBe(READER_CANVAS_SCROLL_MESSAGE);
    expect(readReaderUiMessage(up)).toBe(READER_CANVAS_SCROLL_MESSAGE);
    expect(readReaderUiMessage(jitter)).toBeNull();
    expect(readReaderCanvasScrollEvent(down)).toEqual({ direction: 'down', deltaY: 20 });
    expect(readReaderCanvasScrollEvent(up)).toEqual({ direction: 'up', deltaY: -20 });
    expect(readReaderCanvasScrollEvent(jitter)).toBeNull();
    expect(readReaderUiMessage(invalidDirection)).toBeNull();
    expect(buildReaderDomBridge(true)).toContain('deltaY');
  });

  it('builds a chapter-only YouVersion link from the selected reader version and location', () => {
    const buildLink = (readerConfig as { buildYouVersionChapterUrl?: (versionId: number | null, usfm: string) => string | null }).buildYouVersionChapterUrl;
    expect(buildLink).toBeTypeOf('function');
    expect(buildLink!(46, 'PSA.98')).toBe('https://www.bible.com/bible/46/PSA.98');
    expect(buildLink!(1392, 'JHN.12.27-50')).toBe('https://www.bible.com/bible/1392/JHN.12');
    expect(buildLink!(0, 'PSA.98')).toBeNull();
    expect(buildLink!(46, 'PSA.90-GEN.91')).toBeNull();
    expect(buildLink!(46, '')).toBeNull();
  });
});
