import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { verifyInputs } from '../src/config/inputs';

async function main(): Promise<void> {
  const receipt = await verifyInputs(resolve(process.cwd(), 'data'));
  await mkdir(resolve(process.cwd(), 'docs', 'receipts'), { recursive: true });
  await writeFile(
    resolve(process.cwd(), 'docs', 'receipts', 'input-digests.json'),
    `${JSON.stringify(receipt, null, 2)}\n`,
    'utf8',
  );
  console.log(JSON.stringify(receipt, null, 2));
}

void main();
