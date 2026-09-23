import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { syncDeps } from '../src/config/depsSync';

function main(): void {
  const root = resolve(process.cwd());
  const receipt = syncDeps(root, {
    npmCi: (cwd) => {
      execFileSync('npm', ['ci'], { cwd, stdio: 'inherit', shell: true });
    },
  });
  console.log(JSON.stringify(receipt, null, 2));
}

main();
