import { describe, expect, it, vi } from 'vitest';
import { createAnnouncementClient, parseAnnouncement } from '../../src/services/announcementClient';

const PUBLISHED = {
  week: '2026-09-20',
  generatedAt: '2026-09-21T22:57:23.567Z',
  sermon: {
    title: '先', speaker: '光佑', passage: '創3',
    audio: 'https://drive.google.com/file/d/1CX/view',
    slides: 'https://docs.google.com/presentation/d/1yf/preview',
    transcript: 'https://docs.google.com/document/d/1rW/view',
    youtube: null,
  },
  next: { date: '9/27', topic: '豚汁定食/如何殺柚子', owner: '淑君校長/大廚', signup: 'https://forms.gle/Z7EvQyzCVEmnQYHNA' },
  standing: null,
  past: [{ week: '2026-09-13', title: null, audio: null, slides: 'https://docs.google.com/presentation/d/1Bf/preview', transcript: null }],
};

function memoryStorage(seed?: string) {
  const store = new Map<string, string>();
  if (seed) store.set('qingmu.announcement.latest', seed);
  return {
    store,
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => { store.set(key, value); },
  };
}

const ok = (body: unknown) => vi.fn(async () => ({ ok: true, text: async () => JSON.stringify(body) }) as never);

describe('reading what the weekly job published', () => {
  it('takes the real shape the job emits', () => {
    const announcement = parseAnnouncement(PUBLISHED);
    expect(announcement).toMatchObject({
      week: '2026-09-20',
      sermon: { title: '先', speaker: '光佑', passage: '創3' },
      next: { date: '9/27', signup: 'https://forms.gle/Z7EvQyzCVEmnQYHNA' },
    });
    expect(announcement?.past).toHaveLength(1);
  });

  // A later run adding a field must not stop an older phone rendering the rest. That is the opposite
  // of the points parsers, where an unexpected key means the server started leaking something.
  it('ignores fields a newer publisher added', () => {
    const announcement = parseAnnouncement({ ...PUBLISHED, somethingNew: { a: 1 }, sermon: { ...PUBLISHED.sermon, extra: 'x' } });
    expect(announcement?.sermon?.title).toBe('先');
  });

  it('drops a block that has nothing in it rather than drawing an empty one', () => {
    const announcement = parseAnnouncement({ ...PUBLISHED, sermon: { title: null, speaker: null, passage: null, audio: null, slides: null, transcript: null, youtube: null }, next: null });
    expect(announcement?.sermon).toBeNull();
    expect(announcement?.next).toBeNull();
  });

  it('refuses a payload with no week, because nothing can be dated', () => {
    expect(parseAnnouncement({ sermon: PUBLISHED.sermon })).toBeNull();
    expect(parseAnnouncement('not json at all')).toBeNull();
  });
});

describe('when the announcement cannot be fetched', () => {
  it('keeps the device copy and says it is stale', async () => {
    const storage = memoryStorage(JSON.stringify(PUBLISHED));
    const client = createAnnouncementClient({
      storage, fetchImpl: vi.fn(async () => { throw new Error('offline'); }) as never,
    });
    const result = await client.load();
    expect(result.stale).toBe(true);
    expect(result.announcement?.week).toBe('2026-09-20');
  });

  it('says nothing at all when there is no device copy either', async () => {
    const client = createAnnouncementClient({
      storage: memoryStorage(), fetchImpl: vi.fn(async () => { throw new Error('offline'); }) as never,
    });
    expect(await client.load()).toEqual({ announcement: null, stale: true });
  });

  it('falls back on an http error rather than rendering the error body', async () => {
    const storage = memoryStorage(JSON.stringify(PUBLISHED));
    const client = createAnnouncementClient({
      storage, fetchImpl: vi.fn(async () => ({ ok: false, text: async () => '404: Not Found' }) as never),
    });
    expect((await client.load()).stale).toBe(true);
  });

  it('does not let a bad publish poison the device copy', async () => {
    const storage = memoryStorage(JSON.stringify(PUBLISHED));
    const client = createAnnouncementClient({ storage, fetchImpl: ok({ nonsense: true }) as never });
    const result = await client.load();

    expect(result.stale).toBe(true);
    expect(result.announcement?.week).toBe('2026-09-20');
    // The good copy is still what is stored, so the next launch is not broken too.
    expect(JSON.parse(storage.store.get('qingmu.announcement.latest')!).week).toBe('2026-09-20');
  });
});

describe('a successful fetch', () => {
  it('returns it fresh and remembers it for next time', async () => {
    const storage = memoryStorage();
    const client = createAnnouncementClient({ storage, fetchImpl: ok(PUBLISHED) as never });
    const result = await client.load();

    expect(result).toMatchObject({ stale: false });
    expect(result.announcement?.sermon?.title).toBe('先');
    expect(storage.store.has('qingmu.announcement.latest')).toBe(true);
  });
});
