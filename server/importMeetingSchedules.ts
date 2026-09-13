import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { importMeetingSchedules } from './meetingSchedules';

export function runMeetingImport(args: string[]) {
  const allowed = new Set(['--file', '--database', '--sha256', '--apply']);
  const options: Record<string, string | boolean> = {};
  for (let i=0; i<args.length; i++) {
    const key = args[i];
    if (!allowed.has(key) || key in options) throw new Error('INVALID_IMPORT_ARGUMENTS');
    if (key === '--apply') options[key] = true;
    else { const value = args[++i]; if (!value || value.startsWith('--')) throw new Error('INVALID_IMPORT_ARGUMENTS'); options[key] = value; }
  }
  if (typeof options['--file'] !== 'string' || typeof options['--database'] !== 'string') throw new Error('IMPORT_FILE_AND_DATABASE_REQUIRED');
  const input = readFileSync(options['--file']);
  const sha256 = createHash('sha256').update(input).digest('hex');
  const apply = options['--apply'] === true;
  if (apply && (typeof options['--sha256'] !== 'string' || options['--sha256'].toLowerCase() !== sha256)) throw new Error('IMPORT_SHA256_REQUIRED_OR_CHANGED');
  // Open an existing database directly: no bootstrap, schema creation, membership creation, or credential access.
  if (!statSync(options['--database']).isFile()) throw new Error('IMPORT_DATABASE_MUST_EXIST');
  let parsed: unknown;
  try { parsed = JSON.parse(input.toString('utf8')); } catch { throw new Error('INVALID_IMPORT_JSON'); }
  const db = new DatabaseSync(options['--database'], { readOnly: !apply });
  try { return { input_sha256: sha256, ...importMeetingSchedules(db, parsed, { apply }) }; }
  finally { db.close(); }
}

if (process.argv.some(arg => /(?:^|[\\/])server[\\/]importMeetingSchedules\.ts$/.test(arg))) {
  try { console.log(JSON.stringify(runMeetingImport(process.argv.slice(2)))); }
  catch (error) { console.error(error instanceof Error ? error.message : 'IMPORT_FAILED'); process.exitCode = 1; }
}
