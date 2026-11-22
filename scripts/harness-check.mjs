import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const tests = readdirSync(join(projectRoot, 'scripts'))
  .filter((file) => file.endsWith('.test.mjs'))
  .sort()
  .map((file) => join('scripts', file));

const checks = [
  ['TypeScript', ['node_modules/typescript/bin/tsc', '--noEmit']],
  ['Unit tests', ['--experimental-strip-types', '--test', ...tests]],
];

for (const [label, args] of checks) {
  process.stdout.write(`\n[check] ${label}\n`);
  const result = spawnSync(process.execPath, args, { cwd: projectRoot, stdio: 'inherit' });
  if (result.error) {
    process.stderr.write(`[check] ${label}: ${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

process.stdout.write('\n[check] All checks passed.\n');
