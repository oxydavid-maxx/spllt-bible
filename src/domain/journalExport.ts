/**
 * Turns a journal into one Markdown document the member can take away.
 *
 * Pure on purpose: no React, no native module, no clock. Export is the promise that what someone
 * writes here is theirs, so the part that decides what leaves the app is the part that should be
 * testable without a device.
 */

export interface ExportableEntry {
  taskDate: string;
  body: string;
}

const heading = (taskDate: string): string => {
  const [year, month, day] = taskDate.split('-');
  return `## ${year}年${Number(month)}月${Number(day)}日`;
};

export function buildJournalExport(entries: ReadonlyArray<ExportableEntry>): string {
  const written = entries
    .filter((entry) => entry.body.trim().length > 0)
    .slice()
    .sort((left, right) => left.taskDate.localeCompare(right.taskDate));

  // An export with nothing in it should say so rather than handing over a bare title, which reads
  // like the export failed.
  if (written.length === 0) return '# 靈修日記\n\n（還沒有內容）\n';

  const sections = written.map((entry) => `${heading(entry.taskDate)}\n\n${entry.body.trim()}\n`);
  return `# 靈修日記\n\n${sections.join('\n')}`;
}

/** How many days the export actually carries, for the confirmation line. */
export function countExportableDays(entries: ReadonlyArray<ExportableEntry>): number {
  return entries.filter((entry) => entry.body.trim().length > 0).length;
}
