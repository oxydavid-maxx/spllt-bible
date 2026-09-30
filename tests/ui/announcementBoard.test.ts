import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { primitive } = vi.hoisted(() => ({
  primitive: (name: string) => (props: Record<string, unknown>) => require('react').createElement(name, props, props.children as never),
}));
vi.mock('react-native', () => ({
  Pressable: primitive('Pressable'),
  ScrollView: primitive('ScrollView'),
  Text: primitive('Text'),
  View: primitive('View'),
  StyleSheet: { create: (value: unknown) => value },
}));

import React from 'react';
import { act, create } from 'react-test-renderer';
import { AnnouncementBoard } from '../../src/ui/AnnouncementBoard';
import type { Announcement } from '../../src/services/announcementClient';

beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-30T04:00:00Z')); });
afterAll(() => vi.useRealTimers());

const FULL: Announcement = {
  week: '2026-09-20',
  sermon: {
    title: '先', speaker: '光佑', passage: '創3',
    audio: 'https://drive.google.com/file/d/1CX/view',
    slides: 'https://docs.google.com/presentation/d/1yf/preview',
    sermonSlides: 'https://docs.google.com/presentation/d/1Gd/preview',
    transcript: 'https://docs.google.com/document/d/1rW/view',
    youtube: null,
  },
  next: { date: '9/27', topic: '豚汁定食/如何殺柚子', owner: '淑君校長/大廚', signup: 'https://forms.gle/Z7Ev' },
  standing: { 地址: '新竹市東區龍山西路107號2樓', 地圖: 'https://maps.app.goo.gl/k9NF', 午餐: '80 元（教會補助 80）' },
  past: [{ week: '2026-09-13', title: null, speaker: '中亮', audio: null, slides: 'https://docs.google.com/presentation/d/1Bf/preview', transcript: null }],
};

function render(announcement: Announcement, stale = false, registration: Parameters<typeof AnnouncementBoard>[0]['registration'] = undefined) {
  const onOpen = vi.fn();
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(React.createElement(AnnouncementBoard, { announcement, stale, onOpen, registration })); });
  return {
    onOpen,
    text: () => JSON.stringify(tree.toJSON()),
    byLabel: (label: string) => tree.root.findAll((node) => node.props?.accessibilityLabel === label)[0],
    textNodes: () => tree.root.findAll((node) => String(node.type) === 'Text'),
    wrapRows: () => tree.root.findAll((node) => (node.props?.style as Record<string, unknown>)?.flexWrap === 'wrap'),
  };
}

describe('the notice board', () => {
  it('leads with what is on next and how to sign up', () => {
    const board = render(FULL);
    expect(board.text()).toContain('下次 9/27');
    expect(board.text()).toContain('豚汁定食');
    act(() => { board.byLabel('報名').props.onPress(); });
    expect(board.onOpen).toHaveBeenCalledWith('https://forms.gle/Z7Ev');
  });

  it('shows how many signed up and which friends, under the sign-up button', () => {
    const { text, byLabel } = render(FULL, false, { date: '2026-09-27', total: 12, registered: true, friends: ['陳小華', '大同'] });
    const status = byLabel('報名狀況');
    expect(status).toBeDefined();
    expect(text()).toContain('已有 12 人報名，包括你');
    expect(text()).toContain('朋友：陳小華、大同');
    const quiet = render(FULL, false, { date: '2026-09-27', total: 3, registered: false, friends: [] });
    expect(quiet.text()).toContain('已有 3 人報名');
    expect(quiet.text()).not.toContain('朋友：');
    expect(render(FULL, false, { date: '2026-09-27', total: 0, registered: false, friends: [] }).byLabel('報名狀況')).toBeUndefined();
    expect(render(FULL).byLabel('報名狀況')).toBeUndefined();
  });

  it('gives the sermon its speaker and passage on one line', () => {
    expect(render(FULL).text()).toContain('光佑 · 創3');
  });

  it('keeps the past date and speaker together and lets long names wrap without clipping', () => {
    const longSpeaker = '中亮哥是這一週青年啟發的帶領者';
    const board = render({
      ...FULL,
      past: [{ ...FULL.past[0], speaker: longSpeaker }],
    });
    const line = board.textNodes().find((node) => String(node.props.children).startsWith('9/13 · '));

    expect(line?.props.children).toBe('9/13 · ' + longSpeaker);
    expect(line?.props.numberOfLines).toBeUndefined();
    let row = line?.parent;
    while (row && String(row.type) !== 'View') row = row.parent;
    expect(row?.props.style).toMatchObject({ flexDirection: 'column', alignItems: 'stretch' });
    expect(line?.props.style.minWidth).toBeUndefined();
    expect(board.wrapRows()).not.toHaveLength(0);
  });

  it('puts even a single link below its date and includes the year outside the current Taipei year', () => {
    const board = render({ ...FULL, past: [
      { ...FULL.past[0], week: '2025-12-13', speaker: null },
      { ...FULL.past[0], week: '2026-09-13', title: '本週信息', audio: 'https://example.invalid/audio' },
    ] });
    for (const label of ['2025/12/13', '9/13 · 中亮 · 本週信息']) {
      const line = board.textNodes().find(node => node.props.children === label);
      expect(line).toBeDefined();
      let row = line!.parent;
      while (row && String(row.type) !== 'View') row = row.parent;
      expect(row?.props.style).toMatchObject({ flexDirection: 'column', alignItems: 'stretch' });
    }
  });

  it('opens each sermon link, the 講道 and 報告 decks under their own names', () => {
    const board = render(FULL);
    for (const [label, url] of [['錄音', 'https://drive.google.com/file/d/1CX/view'], ['講道投影片', 'https://docs.google.com/presentation/d/1Gd/preview'], ['報告投影片', 'https://docs.google.com/presentation/d/1yf/preview'], ['逐字稿', 'https://docs.google.com/document/d/1rW/view']]) {
      act(() => { board.byLabel(label).props.onPress(); });
      expect(board.onOpen).toHaveBeenCalledWith(url);
    }
  });

  // A week with no recording yet is the normal state on Sunday morning; the button simply is not
  // there. An empty block saying "no recording" would be noise on every single Sunday.
  it('draws no button for a link the week does not have', () => {
    const board = render({ ...FULL, sermon: { ...FULL.sermon!, audio: null, transcript: null } });
    expect(board.byLabel('錄音')).toBeUndefined();
    expect(board.byLabel('逐字稿')).toBeUndefined();
    expect(board.byLabel('報告投影片')).toBeDefined();
    expect(board.byLabel('投影片')).toBeUndefined();
  });

  it('omits a whole block the published file does not carry', () => {
    const board = render({ ...FULL, next: null, standing: null, past: [] });
    expect(board.byLabel('下次聚會')).toBeUndefined();
    expect(board.byLabel('常設資訊')).toBeUndefined();
    expect(board.byLabel('以前的主日')).toBeUndefined();
    expect(board.byLabel('上次講道')).toBeDefined();
  });

  it('makes a standing value that is a link tappable, and leaves the rest as text', () => {
    const board = render(FULL);
    act(() => { board.byLabel('地圖').props.onPress(); });
    expect(board.onOpen).toHaveBeenCalledWith('https://maps.app.goo.gl/k9NF');
    expect(board.text()).toContain('午餐：80 元（教會補助 80）');
  });

  it('says quietly which week is on screen when the fetch failed', () => {
    expect(render(FULL, true).text()).toContain('目前顯示 9/20 的公告');
    expect(render(FULL, false).text()).not.toContain('還沒連上');
  });
});

describe('the next gathering in full', () => {
  it('shows both sessions with their owners and who serves, from the published file', () => {
    const board = render({
      ...FULL,
      next: {
        ...FULL.next!,
        sessions: [
          { label: '第一堂', kind: '青年啟發', title: '耶穌：耶穌是誰？', owner: '中亮/大專' },
          { label: '第二堂', kind: null, title: '爸媽不在家，我要活下去系列: 豚汁定食/如何殺柚子', owner: '淑君校長/大廚' },
        ],
        roles: [{ label: '講員', value: '中亮' }, { label: '主領(報告)', value: '光佑' }, { label: '招待', value: '小丁/文樂' }],
      },
    });
    const text = board.text();
    for (const expected of ['第一堂', '耶穌：耶穌是誰？', '青年啟發 · 中亮/大專', '第二堂', '淑君校長/大廚', '服事', '講員', '中亮', '主領(報告)', '光佑', '小丁/文樂']) {
      expect(text).toContain(expected);
    }
    expect(board.byLabel('報名')).toBeDefined();
  });

  it('falls back to the single topic when the file has no sessions', () => {
    const text = render(FULL).text();
    expect(text).toContain('豚汁定食/如何殺柚子');
    expect(text).not.toContain('第一堂');
    expect(text).not.toContain('服事');
  });
});
