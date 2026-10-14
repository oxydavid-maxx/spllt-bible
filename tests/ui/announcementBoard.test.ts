import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { primitive } = vi.hoisted(() => ({
  primitive: (name: string) => (props: Record<string, unknown>) => require('react').createElement(name, props, props.children as never),
}));
vi.mock('react-native-svg', () => ({ default: primitive('Svg'), Path: primitive('Path'), Rect: primitive('Rect') }));
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
    expect(board.text()).toContain('下次聚會');
    expect(board.byLabel('下次聚會 9/27').findAll((node) => String(node.type) === 'Text').map((node) => node.props.children)).toEqual(['9 月', '27', '週日']);
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

  it('gives every Sunday its own card with the date down the left, and lets long names wrap without clipping', () => {
    const longSpeaker = '中亮哥是這一週青年啟發的帶領者';
    const board = render({
      ...FULL,
      past: [{ ...FULL.past[0], speaker: longSpeaker }],
    });
    const line = board.textNodes().find((node) => node.props.children === longSpeaker);
    expect(line?.props.numberOfLines).toBeUndefined();
    const card = board.byLabel('9/13 的講道');
    expect(card.findAll((node) => String(node.type) === 'Text').map((node) => node.props.children)).toEqual(expect.arrayContaining(['9/13', longSpeaker]));
    expect(board.wrapRows()).not.toHaveLength(0);
  });

  it('lists the weeks newest first, marks only last Sunday 上週, and includes the year outside the current Taipei year', () => {
    const board = render({ ...FULL, past: [
      { ...FULL.past[0], week: '2025-12-13', speaker: null },
      { ...FULL.past[0], week: '2026-09-13', title: '本週信息', audio: 'https://example.invalid/audio' },
    ] });
    const cards = [...new Set(board.byLabel('講道紀錄').findAll((node) => /的講道$/.test(String(node.props?.accessibilityLabel ?? ''))).map((node) => String(node.props.accessibilityLabel)))];
    expect(cards).toEqual(['9/20 的講道', '9/13 的講道', '2025/12/13 的講道']);
    expect(board.textNodes().filter((node) => node.props.children === '上週')).toHaveLength(1);
    expect(board.byLabel('9/20 的講道').findAll((node) => node.props.children === '上週')).not.toHaveLength(0);
    expect(board.byLabel('9/13 的講道').findAll((node) => String(node.type) === 'Text').map((node) => node.props.children)).toEqual(expect.arrayContaining(['本週信息', '中亮']));
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
    expect(board.byLabel('講道紀錄')).toBeDefined();
    expect(board.byLabel('9/13 的講道')).toBeUndefined();
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
    for (const expected of ['第一堂', '耶穌：耶穌是誰？', '青年啟發 · 中亮/大專', '第二堂', '淑君校長/大廚', '講員', '中亮', '主領', '光佑', '小丁/文樂']) {
      expect(text).toContain(expected);
    }
    // The grid keeps the roster's note off the label; a screen reader still hears it in full.
    expect(board.textNodes().map((node) => node.props.children)).not.toContain('主領(報告)');
    expect(board.byLabel('主領(報告) 光佑')).toBeDefined();
    expect(board.byLabel('報名')).toBeDefined();
  });

  it('falls back to the single topic when the file has no sessions', () => {
    const text = render(FULL).text();
    expect(text).toContain('豚汁定食/如何殺柚子');
    expect(text).not.toContain('第一堂');
    expect(text).not.toContain('服事');
  });
});

it('renders recorded sessions under 上次講道 and opens the second-session deck', () => {
  const second = { ...FULL.sermon!, label: '第二堂', title: '一本書終結你的拖延症', speaker: null, passage: null, audio: null, slides: null, sermonSlides: 'https://example.invalid/book', transcript: null };
  const board = render({ ...FULL, sessions: [{ ...FULL.sermon!, label: '第一堂', slides: null }, second] } as Announcement);
  expect(board.text()).toContain('第二堂');
  expect(board.text()).toContain('一本書終結你的拖延症');
});

it('shows every file when a session has multiple teaching decks', () => {
  const session = { ...FULL.sermon!, label: '第一堂', materials: [
    { name: '教學一', role: 'sermonSlides', url: 'https://example.invalid/one' },
    { name: '教學二', role: 'sermonSlides', url: 'https://example.invalid/two' },
  ] };
  const board = render({ ...FULL, sessions: [session] } as Announcement);
  // Two files of one kind are numbered, never printed by file name (2026-10-14).
  const labels = board.textNodes().map((node) => node.props.children);
  expect(labels).toEqual(expect.arrayContaining(['講道投影片 1', '講道投影片 2']));
  expect(labels).not.toContain('教學二');
});

it('keeps the legacy button order when a single session uses content-classified materials', () => {
  const materials = [
    { name: '逐字稿', role: 'transcript', url: FULL.sermon!.transcript! },
    { name: '報告', role: 'slides', url: FULL.sermon!.slides! },
    { name: '講道', role: 'sermonSlides', url: FULL.sermon!.sermonSlides! },
    { name: '錄音', role: 'audio', url: FULL.sermon!.audio! },
  ];
  const board = render({ ...FULL, sessions: [{ ...FULL.sermon!, label: '第一堂', materials }] } as Announcement);
  const links = board.byLabel('9/20 的講道').findAll(node => String(node.type) === 'Pressable').map(node => node.props.accessibilityLabel);
  expect(links).toEqual(['錄音','講道投影片','報告投影片','逐字稿']);
});

describe('the notice board as decided on 2026-10-14', () => {
  it('puts the next gathering under a dark date block: month, day, weekday', () => {
    const board = render({ ...FULL, week: '2026-10-11', next: { ...FULL.next!, date: '10/18' } });
    const block = board.byLabel('下次聚會 10/18');
    expect(block.findAll((node) => String(node.type) === 'Text').map((node) => node.props.children)).toEqual(['10 月', '18', '週日']);
    expect(board.text()).toContain('下次聚會');
  });

  it('folds a session with nothing of its own into one line, its one file at the end', () => {
    const youth = { ...FULL.sermon!, label: '第二堂', title: '青少團契', speaker: null, passage: null, audio: null, slides: null, sermonSlides: null, transcript: null, materials: [{ name: '教材.pdf', role: 'sermonDoc' as const, url: 'https://example.invalid/doc' }] };
    const board = render({ ...FULL, sessions: [{ ...FULL.sermon!, label: '第一堂' }, youth] });
    const row = board.byLabel('第二堂');
    expect(Object.assign({}, ...[row.props.style].flat().filter(Boolean))).toMatchObject({ flexDirection: 'row', minHeight: 44 });
    expect(row.findAll((node) => String(node.type) === 'Text').map((node) => node.props.children)).toEqual(['第二堂', '青少團契', '教材']);
    act(() => { row.findAll((node) => String(node.type) === 'Pressable')[0].props.onPress(); });
    expect(board.onOpen).toHaveBeenCalledWith('https://example.invalid/doc');
  });
});
