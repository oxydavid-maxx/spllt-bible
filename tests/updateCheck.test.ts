import { describe, expect, it, vi } from 'vitest';
import { compareToInstalled, fetchUpdateState, NO_UPDATE, readPublishedVersion } from '../src/services/updateCheck';

const good = { versionCode: 25, versionName: '0.5.4', url: 'https://example.org/app.apk' };

function respondWith(body: unknown, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
}

describe('reading what was published', () => {
  it('accepts a complete record', () => {
    expect(readPublishedVersion(good)).toMatchObject({ versionCode: 25, versionName: '0.5.4' });
  });

  it.each([
    ['not an object', 'nonsense'],
    ['null', null],
    ['a missing versionCode', { versionName: '0.5.4', url: 'https://x.test' }],
    ['a versionCode that is a string', { ...good, versionCode: '25' }],
    ['a fractional versionCode', { ...good, versionCode: 25.5 }],
    ['an empty versionName', { ...good, versionName: '   ' }],
    ['a missing url', { versionCode: 25, versionName: '0.5.4' }],
    ['an http url', { ...good, url: 'http://example.org/app.apk' }],
  ])('refuses %s', (_label, value) => {
    // Strict on purpose: this decides whether to interrupt somebody. A malformed file has to read as
    // "no update", never as an undismissable banner pointing at undefined.
    expect(readPublishedVersion(value)).toBeNull();
  });

  it('treats a missing note as absent rather than empty', () => {
    expect(readPublishedVersion({ ...good, note: '   ' })?.note).toBeUndefined();
  });

  it('only calls an update mandatory when the file says exactly true', () => {
    expect(readPublishedVersion({ ...good, mandatory: 'true' })?.mandatory).toBe(false);
    expect(readPublishedVersion({ ...good, mandatory: true })?.mandatory).toBe(true);
  });
});

describe('comparing against the build that is running', () => {
  it('reports an update when the published code is higher', () => {
    expect(compareToInstalled(readPublishedVersion(good), 24)).toMatchObject({ available: true, versionName: '0.5.4' });
  });

  it('says nothing when the phone is already on that build', () => {
    expect(compareToInstalled(readPublishedVersion(good), 25)).toEqual(NO_UPDATE);
  });

  it('says nothing when the phone is somehow ahead', () => {
    // A tester on a build that has not been published yet should not be told to downgrade.
    expect(compareToInstalled(readPublishedVersion(good), 26)).toEqual(NO_UPDATE);
  });

  it('says nothing when the installed version could not be read', () => {
    expect(compareToInstalled(readPublishedVersion(good), null)).toEqual(NO_UPDATE);
  });
});

describe('asking, when the network is what it is', () => {
  it('reports the update on a good response', async () => {
    expect(await fetchUpdateState(24, respondWith(good))).toMatchObject({ available: true });
  });

  it('stays quiet on a non-200', async () => {
    expect(await fetchUpdateState(24, respondWith(good, false))).toEqual(NO_UPDATE);
  });

  it('stays quiet when the body is not the shape we publish', async () => {
    expect(await fetchUpdateState(24, respondWith({ latest: '0.5.4' }))).toEqual(NO_UPDATE);
  });

  it('stays quiet when the request throws', async () => {
    const failing = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await fetchUpdateState(24, failing)).toEqual(NO_UPDATE);
  });

  it('stays quiet when the body is not JSON at all', async () => {
    const broken = vi.fn(async () => ({ ok: true, json: async () => { throw new SyntaxError('<html>'); } })) as unknown as typeof fetch;
    expect(await fetchUpdateState(24, broken)).toEqual(NO_UPDATE);
  });
});
