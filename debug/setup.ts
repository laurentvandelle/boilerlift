import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readlinkSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// `npm run debug:setup`: gets this checkout ready for `npm start -- <cmd>`. Safe to run again.
// Installs the root dependencies, builds dist/, installs debug/ dependencies, then, in a worktree,
// links debug/boilerlift.lock.json to the main checkout's copy so every worktree shares one record
// of the instance. It never runs lift and never reads debug/.env.
const debugDir = import.meta.dirname;
const root = dirname(debugDir);
const LOCK = 'boilerlift.lock.json';
const EMPTY_LOCK = `${JSON.stringify({ version: 1, instances: {} }, null, 2)}\n`;

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    console.error(`error: ${command} ${args.join(' ')} failed in ${cwd}`);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

function step(label: string, args: string[], cwd: string): void {
  console.log(`> ${label}`);
  const result = spawnSync('npm', args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    console.error(`error: npm ${args.join(' ')} failed in ${cwd}`);
    process.exit(result.status ?? 1);
  }
}

function mainCheckout(): string {
  const commonDir = run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], root).trim();
  return dirname(commonDir);
}

function linkLockFile(): void {
  const main = mainCheckout();
  if (realpathSync(main) === realpathSync(root)) {
    console.log(`> ${LOCK}: main checkout, left as it is`);
    return;
  }
  const target = resolve(main, 'debug', LOCK);
  if (!existsSync(target)) {
    writeFileSync(target, EMPTY_LOCK, { encoding: 'utf8', flag: 'wx' });
    console.log(`> ${LOCK}: created an empty one in ${join(main, 'debug')}`);
  }
  const link = join(debugDir, LOCK);
  const stats = lstatSync(link, { throwIfNoEntry: false });
  if (stats === undefined) {
    symlinkSync(target, link);
    console.log(`> ${LOCK}: linked to ${target}`);
    return;
  }
  if (stats.isSymbolicLink() && resolve(debugDir, readlinkSync(link)) === target) {
    console.log(`> ${LOCK}: already linked to ${target}`);
    return;
  }
  // Never overwrite a record of the instance: it may hold ids that the main copy lacks.
  console.warn(`warning: ${link} already exists and is not a link to ${target}; left as it is`);
}

step('npm ci (root)', ['ci'], root);
step('npm run build', ['run', 'build'], root);
step('npm ci (debug)', ['ci'], debugDir);
linkLockFile();
console.log('Ready: npm start -- <cmd>');
