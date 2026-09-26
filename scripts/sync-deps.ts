import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { syncDeps } from '../src/config/depsSync';

function main(): void {
  const root = resolve(process.cwd());
  const receipt = syncDeps(root, {
    npmCi: (cwd) => {
      execFileSync('npm', ['ci'], { cwd, stdio: 'inherit', shell: true });
    },
    // The pinned production backends live here; none may run from this tree's node_modules.
    sharedWorktreesDir: process.env.QINGMU_PINNED_WORKTREES_DIR ?? 'C:/dev/machine/worktrees/qingmu-bible',
  });
  console.log(JSON.stringify(receipt, null, 2));
}

main();
