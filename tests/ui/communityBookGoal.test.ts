import { describe, expect, it, vi } from 'vitest';

const { primitive } = vi.hoisted(() => ({
  primitive: (name: string) => (props: Record<string, unknown>) => require('react').createElement(name, props, props.children as never),
}));
vi.mock('react-native', () => ({
  Text: primitive('Text'),
  View: primitive('View'),
  StyleSheet: { create: (value: unknown) => value },
}));

import React from 'react';
import { act, create } from 'react-test-renderer';
import { CommunityProgress } from '../../src/ui/gamification/CommunityProgress';
import type { CommunityBookGoal } from '../../src/services/gamificationApiClient';

const goal = (patch: Partial<CommunityBookGoal> = {}): CommunityBookGoal => ({
  book: '提摩太前書',
  chapters: [
    { chapter: 1, readers: 3 },
    { chapter: 2, readers: 1 },
    { chapter: 3, readers: null },
    { chapter: 4, readers: null },
  ],
  complete: false,
  ...patch,
});

function render(props: Partial<React.ComponentProps<typeof CommunityProgress>> = {}) {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(React.createElement(CommunityProgress, {
      books: ['約', '詩', '提前'], personDays: null, currentBook: goal(), ...props,
    } as never));
  });
  return {
    text: () => JSON.stringify(tree.toJSON()),
    byLabel: (label: string) => tree.root.findAll((node) => node.props?.accessibilityLabel === label)[0],
  };
}

describe('一起讀完一卷書', () => {
  it('names the book and how much of it is lit', () => {
    const view = render();
    expect(view.text()).toContain('提摩太前書');
    expect(view.text()).toContain('2 / 4 章');
  });

  it('shows how many people read a chapter, which is the point of it', () => {
    expect(render().byLabel('第 1 章，3 人讀過')).toBeDefined();
  });

  it('draws no zero in front of the chapters still ahead', () => {
    const view = render();
    expect(view.byLabel('第 3 章，還沒有人讀過')).toBeDefined();
    // A 0 would turn the chapters nobody has reached into a row of failures.
    expect(view.text()).not.toContain('"0"');
  });

  it('says it plainly when the group finishes', () => {
    const chapters = goal().chapters.map((entry) => ({ ...entry, readers: entry.readers ?? 1 }));
    expect(render({ currentBook: goal({ chapters, complete: true }) }).text()).toContain('一起讀完了提摩太前書');
  });

  it('still shows what the group walked through when there is no goal yet', () => {
    const view = render({ currentBook: null });
    expect(view.text()).toContain('一起走過');
    expect(view.text()).not.toContain('提摩太前書');
  });

  it('shows nothing at all before the plan has anything in it', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(React.createElement(CommunityProgress, { books: [], personDays: null, currentBook: null } as never));
    });
    expect(tree.toJSON()).toBeNull();
  });
});
