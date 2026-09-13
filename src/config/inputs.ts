import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const CANONICAL_FILES = [
  'current-design.json',
  'android-implementation-spec.md',
  'september-content-requirements.json',
  'september-2026.json',
] as const;

const SUNDAYS_IN_SEPTEMBER = new Set([
  '2026-09-06',
  '2026-09-13',
  '2026-09-20',
  '2026-09-27',
]);

export type CanonicalInputFile = (typeof CANONICAL_FILES)[number];

export interface InputReceipt {
  fixture: true;
  implementationStarted: boolean;
  scheduledDays: number;
  uniqueChapters: number;
  dates: string[];
  sourceSha256: Record<CanonicalInputFile, string>;
}

function sha256(contents: Buffer): string {
  return createHash('sha256').update(contents).digest('hex');
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function verifyInputs(dataRoot: string): Promise<InputReceipt> {
  const bytes = {} as Record<CanonicalInputFile, Buffer>;
  for (const file of CANONICAL_FILES) {
    bytes[file] = await readFile(join(dataRoot, file));
  }

  const design = JSON.parse(bytes['current-design.json'].toString('utf8')) as Record<string, unknown>;
  const requirements = JSON.parse(
    bytes['september-content-requirements.json'].toString('utf8'),
  ) as {
    plan_sha256?: string;
    chapters?: Array<{ reference?: string; license_status?: string }>;
  };
  const calendar = JSON.parse(bytes['september-2026.json'].toString('utf8')) as {
    days?: Array<{ date?: string; references?: string[] }>;
  };

  const days = calendar.days ?? [];
  const chapters = requirements.chapters ?? [];
  const dates = days.map((day) => day.date ?? '');
  const uniqueChapters = new Set(chapters.map((chapter) => chapter.reference).filter(Boolean));

  assert(typeof design.product_implementation_started === 'boolean', 'canonical input implementation status must be explicit');
  assert(days.length === 26, `fixture must contain exactly 26 scheduled days, got ${days.length}`);
  assert(new Set(dates).size === dates.length, 'fixture contains duplicate scheduled dates');
  assert(dates.every((date) => /^2026-09-\d{2}$/.test(date)), 'fixture contains an out-of-month date');
  assert(
    dates.every((date) => !SUNDAYS_IN_SEPTEMBER.has(date)),
    'fixture must preserve the planned Sunday gap, including 2026-09-06',
  );
  assert(chapters.length === 42 && uniqueChapters.size === 42, 'fixture must contain 42 unique chapters');
  assert(
    requirements.plan_sha256?.toLowerCase() === sha256(bytes['september-2026.json']),
    'content requirements must bind to the unchanged September calendar hash',
  );
  assert(
    chapters.every((chapter) => chapter.license_status === 'not_approved'),
    'approved content cannot be treated as a development fixture',
  );

  return {
    fixture: true,
    implementationStarted: design.product_implementation_started,
    scheduledDays: days.length,
    uniqueChapters: uniqueChapters.size,
    dates,
    sourceSha256: Object.fromEntries(
      CANONICAL_FILES.map((file) => [file, sha256(bytes[file])]),
    ) as Record<CanonicalInputFile, string>,
  };
}
