import { describe, expect, it, vi } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { buildClaudeArgs, createClaudeCli, scrubEnvironment, type SpawnLike } from '../../server/claudeCli';

/**
 * The only place in this product that starts another program, called with text a fourteen-year-old
 * typed into a phone. Everything here is about the boundary rather than the answer.
 */

function fakeSpawn(behaviour: (deliver: (error: Error | null, stdout: string) => void) => void = (deliver) => deliver(null, '300\n')) {
  const calls: Array<{ executable: string; args: string[]; options: Record<string, unknown>; stdin: string }> = [];
  const killed: string[] = [];
  const spawn: SpawnLike = (executable, args, options, done) => {
    const call = { executable, args, options: options as unknown as Record<string, unknown>, stdin: '' };
    calls.push(call);
    behaviour((error, stdout) => done(error, stdout, ''));
    return {
      stdin: { end: (data: string) => { call.stdin = data; } },
      kill: (signal?: string) => { killed.push(signal ?? 'SIGTERM'); },
    };
  };
  return { spawn, calls, killed };
}

describe('what reaches the command line', () => {
  it('takes a model and nothing else, so no student text can become an argument', () => {
    const args = buildClaudeArgs('claude-sonnet-4-5');
    expect(args.slice(0, 3)).toEqual(['-p', '--model', 'claude-sonnet-4-5']);
    expect(buildClaudeArgs.length).toBe(1);
  });

  it('removes tools, MCP servers, user customizations and session persistence explicitly', () => {
    const args = buildClaudeArgs('claude-sonnet-4-5');
    for (const flag of ['--safe-mode', '--strict-mcp-config', '--no-session-persistence', '--disable-slash-commands', '--no-chrome']) {
      expect(args).toContain(flag);
    }
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('');
    expect(JSON.parse(args[args.indexOf('--mcp-config') + 1])).toEqual({ mcpServers: {} });
  });

  it('sends the prompt on stdin, never as an argument', async () => {
    const { spawn, calls } = fakeSpawn();
    const cli = createClaudeCli({ executable: 'claude.exe', spawn });
    await cli.invoke('我想要一副桌遊 --dangerously-skip-permissions');

    expect(calls[0].stdin).toContain('桌遊');
    expect(calls[0].args.join(' ')).not.toContain('桌遊');
    expect(calls[0].args.join(' ')).not.toContain('--dangerously-skip-permissions');
  });
});

describe('what the child process is allowed to see', () => {
  it('runs in a fresh empty directory and removes it after the child finishes', async () => {
    let cwd!: string;
    let contents: string[] | null = null;
    let finish!: () => void;
    const spawn: SpawnLike = (_executable, _args, options, done) => {
      cwd = (options as typeof options & { cwd: string }).cwd;
      contents = typeof cwd === 'string' && existsSync(cwd) ? readdirSync(cwd) : null;
      finish = () => done(null, '300', '');
      return { stdin: { end() {} }, kill() {} };
    };
    const cli = createClaudeCli({ executable: 'claude.exe', spawn });
    const pending = cli.invoke('synthetic estimate');
    finish();
    await expect(pending).resolves.toBe('300');
    expect(cwd).toBeTruthy();
    expect(cwd).not.toBe(process.cwd());
    expect(contents).toEqual([]);
    expect(existsSync(cwd)).toBe(false);
  });

  it('does not reuse a working directory between requests, including a failed launch', async () => {
    const directories: string[] = [];
    const spawn: SpawnLike = (_executable, _args, options) => {
      directories.push((options as typeof options & { cwd: string }).cwd);
      throw new Error('launch failed');
    };
    const cli = createClaudeCli({ executable: 'claude.exe', spawn });
    await expect(cli.invoke('one')).rejects.toMatchObject({ reason: 'SPAWN_FAILED' });
    await expect(cli.invoke('two')).rejects.toMatchObject({ reason: 'SPAWN_FAILED' });
    expect(directories[0]).toBeTruthy();
    expect(directories[0]).not.toBe(directories[1]);
    expect(directories.every((directory) => !existsSync(directory))).toBe(true);
  });

  it('fails closed when the installed CLI rejects an isolation option', async () => {
    const { spawn, calls } = fakeSpawn((deliver) => deliver(Object.assign(new Error('unknown option --safe-mode'), { code: 1 }), ''));
    const cli = createClaudeCli({ executable: 'claude.exe', spawn });
    await expect(cli.invoke('synthetic estimate')).rejects.toMatchObject({ reason: 'SPAWN_FAILED' });
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toContain('--safe-mode');
    expect(cli.busy()).toBe(false);
  });
  it('does not hand the session secret to another program', () => {
    const scrubbed = scrubEnvironment({
      PATH: '/usr/bin', USERPROFILE: 'C:/Users/User',
      QINGMU_SESSION_SECRET: 'the-secret', QINGMU_DB_PATH: 'C:/pilot.sqlite',
      QINGMU_GOOGLE_SERVER_CLIENT_ID: 'client', AWS_SECRET_ACCESS_KEY: 'nope',
    });
    expect(Object.keys(scrubbed).sort()).toEqual(['PATH', 'USERPROFILE']);
  });

  it('keeps what the CLI needs to find its own credentials', () => {
    // Scrubbing USERPROFILE and APPDATA would leave it unable to log in, which fails at runtime and
    // never in a test. Verified against the real executable before this was written.
    const scrubbed = scrubEnvironment({ USERPROFILE: 'C:/Users/User', APPDATA: 'C:/Users/User/AppData/Roaming', LOCALAPPDATA: 'C:/x', HOMEDRIVE: 'C:', HOMEPATH: '/Users/User' });
    expect(Object.keys(scrubbed).sort()).toEqual(['APPDATA', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'USERPROFILE']);
  });

  it('passes nothing on for a variable that is not set', () => {
    expect(scrubEnvironment({})).toEqual({});
  });
});

describe('one at a time, and never forever', () => {
  it('refuses a second call while one is still running', async () => {
    let deliver: ((error: Error | null, stdout: string) => void) | null = null;
    const { spawn, calls } = fakeSpawn((send) => { deliver = send; });
    const cli = createClaudeCli({ executable: 'claude.exe', spawn });

    const first = cli.invoke('one');
    expect(cli.busy()).toBe(true);
    await expect(cli.invoke('two')).rejects.toMatchObject({ reason: 'BUSY' });
    // The point is that the machine running this is also the machine serving the app.
    expect(calls).toHaveLength(1);

    deliver!(null, '300');
    await expect(first).resolves.toBe('300');
    expect(cli.busy()).toBe(false);
  });

  it('frees the slot again after a failure, rather than wedging shut', async () => {
    const { spawn } = fakeSpawn((deliver) => deliver(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }), ''));
    const cli = createClaudeCli({ executable: 'claude.exe', spawn });
    await expect(cli.invoke('one')).rejects.toMatchObject({ reason: 'SPAWN_FAILED' });
    expect(cli.busy()).toBe(false);
  });

  it('asks the child to be killed if it outlasts the deadline', async () => {
    let deliver!: (error: Error | null, stdout: string) => void;
    const { spawn, calls } = fakeSpawn((send) => { deliver = send; });
    const cli = createClaudeCli({ executable: 'claude.exe', spawn, timeoutMs: 45_000 });
    const pending = cli.invoke('one');
    expect(calls[0].options.timeout).toBe(45_000);
    deliver(Object.assign(new Error('timeout'), { killed: true }), '');
    await expect(pending).rejects.toMatchObject({ reason: 'TIMEOUT' });
    expect(existsSync(calls[0].options.cwd as string)).toBe(false);
  });

  it('reports a killed child as a timeout and not as an answer', async () => {
    const { spawn } = fakeSpawn((deliver) => deliver(Object.assign(new Error('timeout'), { killed: true }), ''));
    const cli = createClaudeCli({ executable: 'claude.exe', spawn });
    await expect(cli.invoke('one')).rejects.toMatchObject({ reason: 'TIMEOUT' });
  });
});

describe('what a student wrote stays out of the record', () => {
  it('carries no prompt and no model output in the error it throws', async () => {
    const { spawn } = fakeSpawn((deliver) => deliver(new Error('boom: 我想要一副桌遊'), ''));
    const cli = createClaudeCli({ executable: 'claude.exe', spawn });
    const failure = await cli.invoke('我想要一副桌遊').then(() => null, (error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(JSON.stringify({ message: failure!.message, ...(failure as object) })).not.toContain('桌遊');
  });

  it('never writes to the console, because that is where a note would end up', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { spawn } = fakeSpawn();
    await createClaudeCli({ executable: 'claude.exe', spawn }).invoke('我想要一副桌遊');
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    log.mockRestore();
    error.mockRestore();
  });
});
