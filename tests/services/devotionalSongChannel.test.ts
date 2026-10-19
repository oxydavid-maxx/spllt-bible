import { describe, expect, it } from 'vitest';
import { parseDevotionalPost } from '../../src/services/devotionClient';
const post = { date: '2026-10-19', weekday: '一', passages: '測試書1', title: '假靈修', sections: [{ heading: '默想經文', paragraphs: ['假內容'] }], song: { youtubeId: 'abcdefghijk', title: '假詩歌' } };
describe('devotional channel compatibility', () => {
  it('preserves the exact channel from the new backend', () => {
    expect(parseDevotionalPost({ ...post, song: { ...post.song, channel: '測試《官方頻道 》' } })?.song).toEqual({ ...post.song, channel: '測試《官方頻道 》' });
  });
  it('accepts old backends without channel and normalizes to null', () => {
    expect(parseDevotionalPost(post)?.song).toEqual({ ...post.song, channel: null });
  });
  it('accepts a failed oEmbed without losing the devotional', () => {
    expect(parseDevotionalPost({ ...post, song: { ...post.song, title: null, channel: null } })?.song).toEqual({ ...post.song, title: null, channel: null });
  });
});
