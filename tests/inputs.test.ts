import { describe, expect, it } from 'vitest';
import { mkdtemp, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyInputs } from '../src/config/inputs';

const dataRoot = join(process.cwd(), 'data');

async function copyFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'qingmu-inputs-'));
  await cp(dataRoot, join(root, 'data'), { recursive: true });
  return join(root, 'data');
}

describe('canonical September input boundary', () => {
  it('reports the unchanged 26 scheduled days and 42 unique chapters as a fixture', async () => {
    const receipt = await verifyInputs(dataRoot);

    expect(receipt.fixture).toBe(true);
    expect(receipt.scheduledDays).toBe(26);
    expect(receipt.uniqueChapters).toBe(42);
    expect(receipt.dates).not.toContain('2026-09-06');
    expect(receipt.dates).not.toContain('2026-09-13');
    expect(receipt.sourceSha256['september-2026.json']).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects a fixture with fewer than 26 reading days', async () => {
    const root = await copyFixture();
    const path = join(root, 'september-2026.json');
    const calendar = JSON.parse(await readFile(path, 'utf8'));
    calendar.days = calendar.days.slice(0, 25);
    await writeFile(path, JSON.stringify(calendar));

    await expect(verifyInputs(root)).rejects.toThrow(/26/);
  });

  it('rejects a fixture that fills the planned Sunday gap', async () => {
    const root = await copyFixture();
    const path = join(root, 'september-2026.json');
    const calendar = JSON.parse(await readFile(path, 'utf8'));
    calendar.days[calendar.days.length - 1].date = '2026-09-06';
    await writeFile(path, JSON.stringify(calendar));

    await expect(verifyInputs(root)).rejects.toThrow(/Sunday|週日|2026-09-06/);
  });

  it('rejects approved content from being treated as a development fixture', async () => {
    const root = await copyFixture();
    const path = join(root, 'september-content-requirements.json');
    const requirements = JSON.parse(await readFile(path, 'utf8'));
    requirements.chapters[0].license_status = 'approved';
    await writeFile(path, JSON.stringify(requirements));

    await expect(verifyInputs(root)).rejects.toThrow(/fixture|核准|approved/i);
  });
});
