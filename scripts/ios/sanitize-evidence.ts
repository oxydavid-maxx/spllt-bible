import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MASK = '[REDACTED]';

/** Keep request paths and diagnostic facts, never credential values. Does not modify requests. */
export function redactEvidence(text: string, secrets: readonly string[] = []): string {
  let result = text;
  for (const secret of secrets.filter(Boolean)) {
    for (const value of new Set([secret, encodeURIComponent(secret)])) result = result.split(value).join(MASK);
  }
  return result
    .replace(/((?:[?&]|%3f|%26)(?:app[_-]?key|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token)(?:=|%3d))(.*?)(?=&|%26|#|\s|["'<>]|$)/gi, `$1${MASK}`)
    .replace(/(\bauthorization\s*:\s*bearer\s+)[^\s"'<>]+/gi, `$1${MASK}`);
}

/** Last boundary before upload; a failure prevents uploading unsanitized evidence. */
export function sanitizeEvidenceDirectory(root: string, secrets: readonly string[] = []): { redactedFiles: number } {
  let redactedFiles = 0;
  if (!existsSync(root)) return { redactedFiles };
  const visit = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error('Evidence directory must not contain symbolic links');
      if (stat.isDirectory()) { visit(path); continue; }
      if (!/\.(?:txt|json|log|xml|html)$/i.test(name)) continue;
      const text = readFileSync(path, 'utf8');
      const clean = redactEvidence(text, secrets);
      if (clean !== text) { writeFileSync(path, clean); redactedFiles += 1; }
      if (secrets.some(secret => secret && clean.includes(secret))) throw new Error('Credential sanitization failed');
    }
  };
  visit(resolve(root));
  return { redactedFiles };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = sanitizeEvidenceDirectory(process.argv[2] ?? 'ci-out', [process.env.EXPO_PUBLIC_YOUVERSION_APP_KEY ?? '']);
  console.log(`CI evidence sanitized: ${result.redactedFiles} files`);
}
