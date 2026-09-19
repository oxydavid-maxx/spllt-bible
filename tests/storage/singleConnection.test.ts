import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The journal and the completion ledger share one SQLite connection on device. If a second writer
// is ever opened on qingmu-youth.db, saveCompletion's BEGIN IMMEDIATE starts failing intermittently
// against SQLITE_BUSY — meaning the feature that earns points breaks because of the feature that
// earns none, and only on a real device, only while someone is typing. That is expensive to find
// and trivial to prevent, so it is prevented here.

describe('there is exactly one writer on the device database', () => {
  it('opens the database in exactly one place', () => {
    const source = readFileSync(join(process.cwd(), 'src/storage/mobileDatabase.ts'), 'utf8');
    const calls = source.match(/openDatabaseSync\s*\(/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  it('gives every store the same shared handle rather than its own', () => {
    const source = readFileSync(join(process.cwd(), 'src/storage/mobileDatabase.ts'), 'utf8');
    const exportedStores = source.match(/export function open\w+/g) ?? [];
    expect(exportedStores.length).toBeGreaterThanOrEqual(3);
    for (const store of exportedStores) {
      if (store.includes('openQingmuRepository')) continue;
      const body = source.slice(source.indexOf(store));
      const untilNextExport = body.slice(0, body.indexOf('\n}') + 2);
      expect(untilNextExport).toContain('sharedDatabase');
    }
  });
});
