import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Running the Claude CLI that is already installed on this machine.
 *
 * This is the only place in the product that starts another program, and the text it carries was
 * typed by a teenager into a phone. So the module is about the boundary rather than the answer: what
 * can reach the command line, what the child is allowed to see, how long it may live, and how many
 * of them there can be.
 *
 * It is a separate file from everything that builds a prompt, so that the modules which do handle a
 * student's words never import node:child_process and could not spawn anything if they tried.
 */

/** Long enough for a real answer — 12 to 18 seconds, measured — and short enough to give up on. */
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MODEL = 'claude-sonnet-4-5';
const MAX_OUTPUT_BYTES = 1 << 18;

/**
 * The environment the child is given, by name.
 *
 * An allow-list rather than a delete-list: a new secret added to the backend tomorrow is excluded by
 * default, which is the only version of this that stays correct without anybody remembering it.
 *
 * The home and app-data entries are not incidental. The CLI finds its own credentials through them,
 * and a version of this that scrubbed them would fail at runtime and pass every test.
 */
const INHERITED = [
  'PATH', 'Path', 'PATHEXT', 'ComSpec', 'SystemRoot', 'windir', 'TEMP', 'TMP',
  'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'HOME', 'APPDATA', 'LOCALAPPDATA',
  'ProgramFiles', 'ProgramData', 'NUMBER_OF_PROCESSORS',
] as const;

export function scrubEnvironment(source: Record<string, string | undefined>): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const name of INHERITED) {
    const value = source[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

/**
 * The arguments, which take a model and nothing else.
 *
 * Stdin prevents shell argument injection; it does not constrain the coding agent's tools.
 * Keep authentication, but explicitly remove tools, MCP, custom instructions/hooks/plugins and
 * persisted sessions. Unsupported flags fail the child call; never retry with weaker arguments.
 */
export function buildClaudeArgs(model: string): string[] {
  return [
    '-p', '--model', model,
    '--safe-mode',
    '--tools', '',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--setting-sources', '',
    '--disable-slash-commands', '--no-chrome',
    '--no-session-persistence',
  ];
}

export interface ChildLike {
  stdin: { end(data: string): void } | null;
  kill(signal?: string): void;
}

export type SpawnLike = (
  executable: string,
  args: string[],
  options: { cwd: string; env: Record<string, string>; timeout: number; maxBuffer: number; windowsHide: boolean },
  done: (error: (Error & { code?: string | number; killed?: boolean }) | null, stdout: string, stderr: string) => void,
) => ChildLike;

export type ClaudeFailureReason = 'BUSY' | 'TIMEOUT' | 'SPAWN_FAILED';

/** Carries a short code and never the prompt, the output, or the message it came from. */
export class ClaudeCliError extends Error {
  readonly reason: ClaudeFailureReason;
  constructor(reason: ClaudeFailureReason) {
    super(reason);
    this.name = 'ClaudeCliError';
    this.reason = reason;
  }
}

export interface ClaudeCli {
  invoke(prompt: string): Promise<string>;
  busy(): boolean;
}

export function createClaudeCli(options: {
  executable: string;
  model?: string;
  timeoutMs?: number;
  spawn?: SpawnLike;
  environment?: Record<string, string | undefined>;
}): ClaudeCli {
  const spawn: SpawnLike = options.spawn ?? ((executable, args, settings, done) => execFile(
    executable,
    args,
    // encoding is pinned so stdout arrives as text; env is the scrubbed map and deliberately not
    // spread over process.env, which is the whole point of having scrubbed it.
    { ...settings, encoding: 'utf8' as const, env: settings.env as NodeJS.ProcessEnv },
    (error, stdout, stderr) => done(error as Parameters<typeof done>[0], String(stdout), String(stderr)),
  ) as unknown as ChildLike);
  const model = options.model ?? DEFAULT_MODEL;
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // One at a time. The machine running this is the machine serving the app, and a queue of language
  // models is not something a youth group backend should be able to start.
  let running = false;

  return {
    busy: () => running,
    invoke(prompt: string): Promise<string> {
      if (running) return Promise.reject(new ClaudeCliError('BUSY'));
      running = true;
      return new Promise<string>((resolve, reject) => {
        let settled = false;
        let cwd: string | undefined;
        const finish = (outcome: () => void) => {
          if (settled) return;
          settled = true;
          running = false;
          // Only remove the unique directory created for this invocation, never a caller's path.
          try { if (cwd) rmSync(cwd, { recursive: true, force: true }); }
          catch { reject(new ClaudeCliError('SPAWN_FAILED')); return; }
          outcome();
        };
        let child: ChildLike;
        try {
          cwd = mkdtempSync(join(tmpdir(), 'qingmu-estimate-'));
          child = spawn(options.executable, buildClaudeArgs(model), {
            cwd,
            env: scrubEnvironment(options.environment ?? process.env),
            timeout,
            maxBuffer: MAX_OUTPUT_BYTES,
            windowsHide: true,
          }, (error, stdout) => {
            // The error from the child can quote the prompt back. Only the classification survives.
            if (error) finish(() => reject(new ClaudeCliError(error.killed ? 'TIMEOUT' : 'SPAWN_FAILED')));
            else finish(() => resolve(String(stdout).trim()));
          });
        } catch {
          finish(() => reject(new ClaudeCliError('SPAWN_FAILED')));
          return;
        }
        try { child.stdin?.end(prompt); }
        catch { child.kill(); finish(() => reject(new ClaudeCliError('SPAWN_FAILED'))); }
      });
    },
  };
}
