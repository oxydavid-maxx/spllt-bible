import { describe, expect, it } from 'vitest';
import { createReaderAutoplayController, type AutoplayChapter } from '../../src/services/readerAutoplayController';

const chapter = (index: number, usfm: string): AutoplayChapter => ({ index, usfm, reference: usfm });

describe('reader autoplay controller', () => {
  it('advances exactly once after a started chapter reaches EOF', () => {
    const controller = createReaderAutoplayController();
    controller.setEnabled(true);
    controller.begin(chapter(0, 'JHN.18'));

    const first = controller.onEof(chapter(0, 'JHN.18'), chapter(1, 'JHN.19'));
    expect(first.kind).toBe('advance');
    if (first.kind !== 'advance') throw new Error('expected advance');
    expect(first.intent).toMatchObject({ index: 1, usfm: 'JHN.19' });

    // A duplicate native EOF from chapter 18 must not skip chapter 19.
    const duplicate = controller.onEof(chapter(0, 'JHN.18'), chapter(2, 'JHN.20'));
    expect(duplicate).toEqual({ kind: 'ignore', reason: 'stale' });
    expect(controller.isIntentCurrent(first.intent)).toBe(true);
  });

  it('stops at the final chapter and makes pause/cancel invalidate pending advancement', () => {
    const controller = createReaderAutoplayController();
    controller.setEnabled(true);
    controller.begin(chapter(1, 'JHN.19'));
    expect(controller.onEof(chapter(1, 'JHN.19'), null)).toEqual({ kind: 'stop', reason: 'last' });

    controller.begin(chapter(0, 'JHN.18'));
    const next = controller.onEof(chapter(0, 'JHN.18'), chapter(1, 'JHN.19'));
    expect(next.kind).toBe('advance');
    if (next.kind !== 'advance') throw new Error('expected advance');
    controller.cancel();
    expect(controller.isIntentCurrent(next.intent)).toBe(false);
  });

  it('never creates an intent while disabled and resume can arm the same chapter again', () => {
    const controller = createReaderAutoplayController();
    controller.setEnabled(false);
    expect(controller.begin(chapter(0, 'JHN.18'))).toBeNull();
    expect(controller.onEof(chapter(0, 'JHN.18'), chapter(1, 'JHN.19'))).toEqual({ kind: 'ignore', reason: 'disabled' });

    controller.setEnabled(true);
    const resumed = controller.begin(chapter(0, 'JHN.18'));
    expect(resumed).toMatchObject({ index: 0, usfm: 'JHN.18' });
  });
});
