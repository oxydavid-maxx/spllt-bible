import type { Congregation } from '../../services/devotionClient';

/**
 * The words for 青少/主堂 (維護者 2026-10-20, mock v3). Every sentence about where a member meets says "我" and
 * names both the side they are on and the side they are not, so an older member cannot read past it:
 * 「我在主堂聚會 (不是青少)」. One place, so the first choice, the 積分 page and 我的帳戶 never drift apart.
 */
export const SIDE_NAME: Record<Congregation, string> = { youth: '青少', main: '主堂' };
/** The group card counts 主堂 as the whole church (青少 included), so it is named 全教會 there. */
export const GROUP_NAME: Record<Congregation, string> = { youth: '青少', main: '全教會' };

export const CHOICES: ReadonlyArray<{ value: Congregation; name: string; detail: string }> = [
  { value: 'youth', name: '青少', detail: '國中、高中、大專學生' },
  { value: 'main', name: '主堂', detail: '社青、家長、長輩' },
];

export function otherSide(side: Congregation): Congregation {
  return side === 'youth' ? 'main' : 'youth';
}

/** 「我在主堂聚會」 and the quieter 「(不是青少)」, kept apart so a screen can set the second one lighter. */
export function whereParts(side: Congregation): { says: string; not: string } {
  return { says: `我在${SIDE_NAME[side]}聚會`, not: `(不是${SIDE_NAME[otherSide(side)]})` };
}

/** 「我在主堂聚會 (不是青少)」 */
export function whereSentence(side: Congregation): string {
  const parts = whereParts(side);
  return `${parts.says} ${parts.not}`;
}

export const QUESTION = '我平常在哪裡聚會？';
