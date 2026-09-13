import * as webSdk from '@youversion/platform-react-ui';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadReaderSettingsSdk as loadSdk } from '../helpers/loadReaderSettingsSdk';

type Snapshot = { fontSize: number; fontFamily: string; lineSpacing: number };

let sdk: ReturnType<typeof loadSdk>;
function api() {
  for (const name of ['getReaderSettings', 'getDefaultReaderSettings', 'setReaderSettings', 'subscribeReaderSettings']) expect(sdk.api[name], `Missing Qingmu extension at SDK package root: ${name}`).toBeTypeOf('function');
  return sdk.api as {
    getReaderSettings(): Snapshot;
    getDefaultReaderSettings(): Snapshot;
    setReaderSettings(value: Partial<Snapshot>): void;
    subscribeReaderSettings(listener: (snapshot: Snapshot) => void): () => void;
  };
}
beforeEach(() => { sdk = loadSdk(); });

describe('Qingmu SDK reader-settings extension on the actual SDK store', () => {
  it('exports only snapshot operations, keeps the store private and returns independent SDK defaults', () => {
    const facade = api();
    expect(sdk.api.useReaderSettingsStore).toBeUndefined();
    expect(facade.getDefaultReaderSettings()).toEqual({ fontSize: webSdk.BIBLE_READER_FONT.DEFAULT, fontFamily: sdk.fonts.UNTITLED_SERIF_FONT, lineSpacing: sdk.spacing.DEFAULT });
    expect(facade.getReaderSettings()).toEqual(facade.getDefaultReaderSettings());
    const copy = facade.getReaderSettings(); copy.fontSize = 999;
    const defaults = facade.getDefaultReaderSettings(); defaults.lineSpacing = 999;
    expect(facade.getReaderSettings().fontSize).toBe(webSdk.BIBLE_READER_FONT.DEFAULT);
    expect(facade.getDefaultReaderSettings().lineSpacing).toBe(sdk.spacing.DEFAULT);
  });
  it('applies SDK clamps and normalization with one observable snapshot and one SDK persist write', () => {
    const facade = api(), received: Snapshot[] = [];
    facade.subscribeReaderSettings(next => received.push(next));
    const before = sdk.writes();
    facade.setReaderSettings({ fontSize: 999, fontFamily: sdk.fonts.INTER_FONT, lineSpacing: sdk.spacing.LG });
    expect(facade.getReaderSettings()).toEqual({ fontSize: webSdk.BIBLE_READER_FONT.MAX, fontFamily: sdk.fonts.INTER_FONT, lineSpacing: sdk.spacing.LG });
    expect(received).toEqual([facade.getReaderSettings()]);
    expect(sdk.writes() - before).toBe(1);
    facade.setReaderSettings({ fontSize: -99, fontFamily: sdk.fonts.SOURCE_SERIF_FONT, lineSpacing: 123 });
    expect(facade.getReaderSettings()).toEqual({ fontSize: webSdk.BIBLE_READER_FONT.MIN, fontFamily: sdk.fonts.UNTITLED_SERIF_FONT, lineSpacing: sdk.spacing.DEFAULT });
  });
  it('observes the official UI setters and supplies the same values to the original reader store', () => {
    const facade = api(), observed: Snapshot[] = [];
    facade.subscribeReaderSettings(snapshot => observed.push(snapshot));
    sdk.actualStore.getState().setFontSize(18);
    sdk.actualStore.getState().setFontFamily(sdk.fonts.INTER_FONT);
    sdk.actualStore.getState().setLineSpacing(sdk.spacing.SM);
    expect(observed.at(-1)).toEqual(facade.getReaderSettings());
    facade.setReaderSettings({ fontSize: 14, lineSpacing: sdk.spacing.LG });
    const readerState = sdk.actualStore.getState();
    expect({ fontSize: readerState.fontSize, fontFamily: readerState.fontFamily, lineSpacing: readerState.lineSpacing }).toEqual(facade.getReaderSettings());
    expect(typeof readerState.setFontSize).toBe('function');
  });
  it('notifies only real preference changes and reliably unsubscribes', () => {
    const facade = api(), observed: Snapshot[] = [];
    const stop = facade.subscribeReaderSettings(snapshot => { observed.push({ ...snapshot }); snapshot.fontSize = 999; });
    const writes = sdk.writes();
    facade.setReaderSettings({}); facade.setReaderSettings(facade.getReaderSettings());
    expect(sdk.writes()).toBe(writes);
    sdk.actualStore.getState().setFontSize(facade.getReaderSettings().fontSize);
    expect(observed).toEqual([]);
    facade.setReaderSettings({ fontSize: 18 });
    expect(observed).toHaveLength(1);
    expect(facade.getReaderSettings().fontSize).toBe(18);
    stop(); stop(); facade.setReaderSettings({ fontSize: 20 });
    expect(observed).toHaveLength(1);
  });
  it.each([null, [], { fontSize: NaN }, { fontSize: Infinity }, { lineSpacing: -Infinity }, { fontSize: '18' }, { fontFamily: '' }, { fontFamily: 'x'.repeat(257) }, { fontFamily: 'Unapproved Font' }, { unknown: true }])('rejects corrupt input atomically: %j', (bad) => {
    const facade = api(), before = facade.getReaderSettings(), writes = sdk.writes();
    expect(() => facade.setReaderSettings(bad as Partial<Snapshot>)).toThrow(TypeError);
    expect(facade.getReaderSettings()).toEqual(before); expect(sdk.writes()).toBe(writes);
  });
  it('does not apply valid fields if another field is invalid', () => {
    const facade = api(), before = facade.getReaderSettings();
    expect(() => facade.setReaderSettings({ fontSize: 18, fontFamily: '' })).toThrow(TypeError);
    expect(facade.getReaderSettings()).toEqual(before);
    expect(() => facade.subscribeReaderSettings(null as never)).toThrow(TypeError);
  });
});
