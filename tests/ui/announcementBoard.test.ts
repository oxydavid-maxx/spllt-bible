import { describe, expect, it, vi } from 'vitest';

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

const FULL: Announcement = {
  week: '2026-09-20',
  sermon: {
    title: '先', speaker: '光佑', passage: '創3',
    audio: 'https://drive.google.com/file/d/1CX/view',
    slides: 'https://docs.google.com/presentation/d/1yf/preview',
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
    expect(line?.props.style).toMatchObject({ flexGrow: 1, flexBasis: 140, minWidth: 140 });
    expect(board.wrapRows()).not.toHaveLength(0);
  });

  it('opens each of the three sermon links', () => {
    const board = render(FULL);
    for (const [label, url] of [['錄音', 'https://drive.google.com/file/d/1CX/view'], ['投影片', 'https://docs.google.com/presentation/d/1yf/preview'], ['逐字稿', 'https://docs.google.com/document/d/1rW/view']]) {
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
    expect(board.byLabel('投影片')).toBeDefined();
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
