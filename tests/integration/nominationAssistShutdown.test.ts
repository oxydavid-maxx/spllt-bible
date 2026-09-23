import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../server/db';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../../server/claudeCli', () => ({ createClaudeCli: () => ({ busy: () => false, invoke }) }));
import { createHttpServer } from '../../server/http';

afterEach(() => vi.unstubAllEnvs());

describe('backend shutdown while a nomination estimate is running', () => {
  it.each(['legacy-close', 'stop'] as const)('%s keeps the database open until the worker has stored the pending answer', async (method) => {
    vi.stubEnv('QINGMU_CLAUDE_CLI_PATH', 'synthetic-cli-no-process');
    const database = createDatabase({ members: [{ id: 'm', displayName: 'Synthetic', groupId: 'g' }] });
    const close = vi.spyOn(database, 'close');
    const backend = createHttpServer({ database, fixtureToken: 'synthetic' });
    database.db.prepare("INSERT INTO reward_nominations(nomination_id,name,created_by,status,revision,created_at,updated_at) VALUES('n','gift','m','OPEN',1,0,0)").run();
    let answer!: (value: string) => void;
    invoke.mockImplementationOnce(() => new Promise<string>((resolve) => { answer = resolve; }));
    const pending = backend.assistWorker!.tick().then(() => null, (error: unknown) => error);
    await new Promise<void>((resolve) => backend.server.listen(0, '127.0.0.1', resolve));
    try {
      if (method === 'legacy-close') await new Promise<void>((resolve) => backend.server.close(() => resolve()));
      else {
        const stopping = backend.stop();
        expect(backend.stop()).toBe(stopping);
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      expect(close).not.toHaveBeenCalled();
      expect(() => database.db.prepare('SELECT 1').get()).not.toThrow();
    } finally { answer('300'); await pending; }
    expect(await pending).toBeNull();
    await backend.stop();
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  });
});
