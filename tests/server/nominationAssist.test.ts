import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../server/db';
import { ensureNominationSchema } from '../../server/rewardNominations';
import {
  buildEstimatePrompt, buildSuggestionPrompt, createNominationAssistWorker,
  parseEstimate, parseSuggestion, pointsFromTwd, readAssist,
} from '../../server/nominationAssist';

/**
 * A price a model guessed, shown to a fourteen-year-old who does not know it was guessed.
 *
 * Everything here exists because of that. The number is rounded so it reads as an estimate, bounded
 * so an absurd one is shown as nothing at all rather than as a refusal, and stored in the currency
 * the model can actually reason about.
 */

const databases: Array<{ close: () => void }> = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function setup() {
  const database = createDatabase({ members: [{ id: 'm-1', displayName: '小明', groupId: 'g' }] });
  databases.push(database);
  ensureNominationSchema(database.db);
  const reward = (name: string, costPoints: number) =>
    database.db.prepare(`INSERT INTO rewards(reward_id, name, cost_points, active, revision, created_at, updated_at, updated_by)
      VALUES(?,?,?,1,1,0,0,'admin')`).run(`r-${name}`, name, costPoints);
  const nominate = (id: string, name: string, note: string | null) =>
    database.db.prepare(`INSERT INTO reward_nominations(nomination_id, name, note, created_by, status, revision, created_at, updated_at)
      VALUES(?,?,?,'m-1','OPEN',1,0,0)`).run(id, name, note);
  return { database, reward, nominate };
}

describe('reading a price out of whatever the model said', () => {
  it('takes a bare number', () => expect(parseEstimate('300')).toBe(300));
  it('takes the number it wrapped in the usual decoration', () => {
    expect(parseEstimate('NT$1,200')).toBe(1200);
    expect(parseEstimate('約 350 元')).toBe(350);
    expect(parseEstimate('４５０')).toBe(450);
  });
  it('refuses a sentence, because a sentence is not a price', () => {
    expect(parseEstimate('這個獎品大概要看品牌而定,價格範圍很廣')).toBeNull();
    expect(parseEstimate('300-500')).toBeNull();
    expect(parseEstimate('')).toBeNull();
  });
  it('refuses a number nobody meant', () => {
    expect(parseEstimate('5')).toBeNull();
    expect(parseEstimate('999999')).toBeNull();
  });
});

describe('what the price is worth in points', () => {
  it('converts through the prize the group already agreed on', () => {
    const { database, reward } = setup();
    reward('電影票', 75);
    expect(pointsFromTwd(database.db, 300)).toBe(75);
    expect(pointsFromTwd(database.db, 1000)).toBe(250);
  });

  it('follows the anchor when a 輔導 reprices it, with nothing re-estimated', () => {
    const { database, reward } = setup();
    reward('電影票', 50);
    // Same 300 元 estimate as above. The stored fact is the price, so the points move on their own.
    expect(pointsFromTwd(database.db, 300)).toBe(50);
  });

  it('rounds to a five, so it reads as a guess rather than a calculation', () => {
    const { database, reward } = setup();
    reward('電影票', 75);
    // 290 元 is 72.5 points exactly. 約 73 分 would claim an arithmetic nobody did.
    expect(pointsFromTwd(database.db, 290)).toBe(75);
    expect(pointsFromTwd(database.db, 250)).toBe(65);
  });

  it('shows nothing rather than a number that reads as a refusal', () => {
    const { database, reward } = setup();
    reward('電影票', 75);
    // Ten times the dearest prize on the shelf is past the point of being useful information.
    expect(pointsFromTwd(database.db, 4000)).toBeNull();
  });

  it('still works before anybody has set up a prize at all', () => {
    const { database } = setup();
    expect(pointsFromTwd(database.db, 300)).toBe(75);
  });
});

describe('the rewrite it offers, and when it offers none', () => {
  it('says nothing when the model is content', () => {
    expect(parseSuggestion('OK', '我想要一副桌遊')).toBeNull();
    expect(parseSuggestion('ok\n', '我想要一副桌遊')).toBeNull();
  });
  it('offers the rewrite when there is one', () => {
    expect(parseSuggestion('大家一起玩的桌遊,聚會後可以用。', '桌遊')).toBe('大家一起玩的桌遊,聚會後可以用。');
  });
  it('offers nothing when the rewrite is what was already written', () => {
    expect(parseSuggestion('  我想要一副桌遊 ', '我想要一副桌遊')).toBeNull();
  });
  it('offers nothing when the model runs away with itself', () => {
    expect(parseSuggestion('好'.repeat(400), '桌遊')).toBeNull();
  });
});

describe('what the prompts carry', () => {
  it('keeps the note inside the prompt and asks for one number', () => {
    const prompt = buildEstimatePrompt('桌遊', '大家一起玩');
    expect(prompt).toContain('桌遊');
    expect(prompt).toContain('大家一起玩');
    expect(prompt).toContain('新台幣');
  });
  it('asks for OK when there is nothing to say', () => {
    expect(buildSuggestionPrompt('大家一起玩')).toContain('OK');
  });
});

describe('the worker that does the waiting', () => {
  const cliDouble = (answers: string[]) => {
    const prompts: string[] = [];
    let index = 0;
    return {
      prompts,
      busy: () => false,
      invoke: vi.fn(async (prompt: string) => { prompts.push(prompt); return answers[index++] ?? 'OK'; }),
    };
  };

  it('picks up a nomination that was created before any of this existed', async () => {
    const { database, reward, nominate } = setup();
    reward('電影票', 75);
    nominate('n-old', '桌遊', '大家一起玩');
    const cli = cliDouble(['300', 'OK']);
    // Nothing was queued when the row was written. The worker finds it anyway, which is why
    // "created but never enqueued" is not a thing that can happen here.
    await createNominationAssistWorker({ db: database.db, cli, now: () => new Date(0) }).tick();

    const assist = readAssist(database.db, 'n-old');
    expect(assist?.estimatedTwd).toBe(300);
    expect(assist?.state).toBe('DONE');
  });

  it('stores the price, not the points, so the points stay live', async () => {
    const { database, reward, nominate } = setup();
    reward('電影票', 75);
    nominate('n-1', '桌遊', null);
    await createNominationAssistWorker({ db: database.db, cli: cliDouble(['1000']), now: () => new Date(0) }).tick();

    expect(readAssist(database.db, 'n-1')?.estimatedTwd).toBe(1000);
    expect(pointsFromTwd(database.db, readAssist(database.db, 'n-1')!.estimatedTwd!)).toBe(250);
  });

  it('gives up on an unusable answer instead of asking again', async () => {
    const { database, reward, nominate } = setup();
    reward('電影票', 75);
    nominate('n-2', '一個願望', null);
    const cli = cliDouble(['這要看你想要什麼']);
    const worker = createNominationAssistWorker({ db: database.db, cli, now: () => new Date(0) });
    await worker.tick();
    await worker.tick();

    // The same prompt produces the same kind of answer. Asking twice only spends the machine.
    expect(cli.invoke).toHaveBeenCalledTimes(1);
    expect(readAssist(database.db, 'n-2')?.state).toBe('FAILED');
    expect(readAssist(database.db, 'n-2')?.estimatedTwd).toBeNull();
  });

  it('tries a timeout once more, because that one was not about the question', async () => {
    const { database, reward, nominate } = setup();
    reward('電影票', 75);
    nominate('n-3', '桌遊', null);
    const failing = {
      busy: () => false,
      invoke: vi.fn(async () => { throw Object.assign(new Error('TIMEOUT'), { reason: 'TIMEOUT' }); }),
    };
    const worker = createNominationAssistWorker({ db: database.db, cli: failing, now: () => new Date(0) });
    await worker.tick();
    expect(readAssist(database.db, 'n-3')?.state).toBe('PENDING');
    await worker.tick();
    expect(failing.invoke).toHaveBeenCalledTimes(2);
    expect(readAssist(database.db, 'n-3')?.state).toBe('FAILED');
    await worker.tick();
    expect(failing.invoke).toHaveBeenCalledTimes(2);
  });

  it('starts nothing while the last one is still running', async () => {
    const { database, reward, nominate } = setup();
    reward('電影票', 75);
    nominate('n-4', '桌遊', null);
    const cli = { busy: () => true, invoke: vi.fn(async () => '300') };
    await createNominationAssistWorker({ db: database.db, cli, now: () => new Date(0) }).tick();
    expect(cli.invoke).not.toHaveBeenCalled();
  });

  it('leaves a decided nomination alone', async () => {
    const { database, reward, nominate } = setup();
    reward('電影票', 75);
    nominate('n-5', '桌遊', null);
    database.db.prepare("UPDATE reward_nominations SET status = 'APPROVED' WHERE nomination_id = 'n-5'").run();
    const cli = cliDouble(['300']);
    await createNominationAssistWorker({ db: database.db, cli, now: () => new Date(0) }).tick();
    expect(cli.invoke).not.toHaveBeenCalled();
  });

  it('writes no part of the note into the console', async () => {
    const { database, reward, nominate } = setup();
    reward('電影票', 75);
    nominate('n-6', '桌遊', '我想要一副大家一起玩的桌遊');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await createNominationAssistWorker({ db: database.db, cli: cliDouble(['這不是數字']), now: () => new Date(0) }).tick();
    for (const spy of [log, error]) {
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain('桌遊');
    }
    log.mockRestore();
    error.mockRestore();
  });
});

describe('the module that handles what students wrote', () => {
  it('cannot start a process, because it does not import the means to', () => {
    const source = readFileSync(new URL('../../server/nominationAssist.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('child_process');
  });
});
