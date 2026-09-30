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
});
