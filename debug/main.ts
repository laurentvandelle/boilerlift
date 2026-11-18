import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

// Runs the built CLI as a user would, with this script's arguments: `node main.ts ping`, `node main.ts deploy --json`.
// With no argument it runs deploy on the target of ./boilerlift.config.ts, whose workflows are ./workflows
// (demo.workflow.ts and sub/other.json): a second run skips both.
const bin = join(import.meta.dirname, '..', 'dist', 'bin.js');
const args = process.argv.slice(2);
execFileSync(process.execPath, [bin, ...(args.length > 0 ? args : ['deploy'])], { stdio: 'inherit' });
