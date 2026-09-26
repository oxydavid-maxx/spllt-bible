import { readFileSync, writeFileSync } from 'node:fs';
import { buildReadingPlan2026 } from '../src/domain/readingPlanImport';

// usage: tsx scripts/build-reading-plan.ts
// Rewrites data/reading-plan-2026.json from data/september-2026.json and the church sheet's cells in
// data/source/2026-reading-plan-cells.json. tests/domain/readingPlan2026.test.ts fails if they drift.
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const plan = buildReadingPlan2026(read('data/september-2026.json'), read('data/source/2026-reading-plan-cells.json'));
writeFileSync('data/reading-plan-2026.json', `${JSON.stringify(plan, null, 2)}\n`);
console.log(`data/reading-plan-2026.json: ${plan.days.length} reading days, ${plan.days[0].date} to ${plan.days[plan.days.length - 1].date}`);
