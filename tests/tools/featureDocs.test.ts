import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// docs/features/README.md is how people remember what the app does. A spec the list never links to is a
// feature nobody will find; a link to a missing spec is a feature the list claims but nobody wrote down.
const specs = readdirSync('docs/features').filter((name) => name.endsWith('.md') && name !== 'README.md');
const list = readFileSync('docs/features/README.md', 'utf8');
const linked = new Set([...list.matchAll(/\]\(([a-z0-9-]+\.md)(?:#[^)]*)?\)/g)].map((match) => match[1]));

describe('feature list', () => {
  it('links every feature spec', () => {
    expect(specs.filter((name) => !linked.has(name))).toEqual([]);
  });

  it('links only specs that exist', () => {
    expect([...linked].filter((name) => !specs.includes(name))).toEqual([]);
  });

  // The journal stays on the phone for privacy, a decision that lived only in conversation until an audit
  // read the unused upload code as an unfinished bug. Each spec says why, not only what.
  it('gives every spec a decisions section', () => {
    expect(specs.filter((name) => !/^## 決定/m.test(readFileSync(`docs/features/${name}`, 'utf8')))).toEqual([]);
  });

  it('documents the delivered 0.5.22 behavior and the journal privacy guard', () => {
    const plan = readFileSync('docs/features/reading-plan.md', 'utf8');
    const journal = readFileSync('docs/features/journal.md', 'utf8');
    expect(list).not.toContain('## 規劃中（0.5.22）');
    expect(plan).not.toContain('## 規劃中（0.5.22）');
    expect(plan).toContain('ReadingPlanSheet');
    expect(journal).toContain('tests/tools/journalPrivacy.test.ts');
    expect(journal).not.toContain('src/services/journalApiClient.ts');
  });
});
