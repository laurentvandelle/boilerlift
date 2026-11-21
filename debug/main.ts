import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// Runs the built CLI as a user would, with this script's arguments. From the root, `npm start -- <cmd> [args]`
// builds dist/, then runs this script in debug/: `npm start -- ping`, `npm start -- deploy --json`.
// With no argument it runs deploy on the dev target of ./boilerlift.config.ts, whose workflows are ./workflows
// (demo.workflow.ts and sub/other.json): a second run skips both. `npm start -- deploy --target prod` deploys
// ./workflows-prod, which resolves credential() through credentials/prod.ts.
const bin = join(import.meta.dirname, '..', 'dist', 'bin.js');
const args = process.argv.slice(2);
// The CLI's exit code becomes this script's, without a stack trace when it is not 0.
process.exitCode = spawnSync(process.execPath, [bin, ...(args.length > 0 ? args : ['deploy', '--target', 'dev'])], { stdio: 'inherit' }).status ?? 1;
