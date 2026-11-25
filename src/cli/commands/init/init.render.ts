import { CliResult } from '#src/cli/cli.model';
import { InitFile } from '#src/cli/commands/init/init.model';
import { Row, SYMBOLS, next, rows, sections } from '#src/cli/output.render';
import { EXIT_INIT_WRITE_FAILED, EXIT_OK, EXIT_USAGE, ExitCode } from '#src/cli/exit-codes';

/** Printed before the next steps: the project is not usable until they are run. */
export const NEXT_STEPS_HEADING = 'The project is not ready yet. Run these commands, in order, to finish the setup:';

/** The Claude Code settings of the template, which wire the hook of the Agent kit. */
const SETTINGS_PATH = '.claude/settings.json';

/** The `PreToolUse` entry of the template's settings, for a project whose settings were already there. */
const HOOK_ENTRY =
  '{ "matcher": "Bash|Read|Grep", "hooks": [{ "type": "command", "command": "node --disable-warning=ExperimentalWarning \\"$CLAUDE_PROJECT_DIR/.claude/hooks/guard.ts\\"" }] }';

/**
 * The files of the project, one row each (`✓` created, `–` skipped, `✗` failed), then the next steps. A failed write
 * exits EXIT_INIT_WRITE_FAILED, with the count on stderr. The --json payload holds the folder, the files, the next
 * steps and the exit code.
 */
export function renderInit(files: InitFile[], folder: string, format: { json: boolean }): CliResult {
  const failed = files.filter((file) => file.status === 'failed');
  const exitCode: ExitCode = failed.length === 0 ? EXIT_OK : EXIT_INIT_WRITE_FAILED;
  const steps = nextSteps(folder, files);
  const stderr =
    failed.length === 0 ? '' : sections([`${failed.length} of ${files.length} files could not be written.`], [next('lift init', 'writes them')]);
  if (format.json) {
    const payload = {
      folder,
      files: files.map(filePayload),
      next: steps,
      exitCode,
    };
    return { exitCode, stdout: `${JSON.stringify(payload, null, 2)}\n`, stderr };
  }
  return { exitCode, stdout: sections(rows(files.map(fileRow)), [NEXT_STEPS_HEADING, ...steps.map((step) => next(step))]), stderr };
}

/** More than one folder given: exit 1, nothing written. */
export function renderTooManyFolders(positionals: string[], format: { json: boolean }): CliResult {
  return usageError('too-many-folders', `lift init takes one folder, not ${positionals.length}: ${positionals.join(' ')}`, format);
}

/** The folder given is an existing file: exit 1, nothing written. */
export function renderFolderIsFile(folder: string, format: { json: boolean }): CliResult {
  return usageError('folder-is-file', `Cannot start a project in ${folder}: it is a file, not a folder.`, format);
}

function usageError(kind: string, message: string, format: { json: boolean }): CliResult {
  const text = sections([message, `  ${next('Name a new or existing folder, for example lift init my-workflows.')}`]);
  if (!format.json) {
    return { exitCode: EXIT_USAGE, stdout: '', stderr: text };
  }
  const payload = { error: { kind, message }, exitCode: EXIT_USAGE };
  return { exitCode: EXIT_USAGE, stdout: `${JSON.stringify(payload, null, 2)}\n`, stderr: text };
}

/** A file as --json prints it: `created`, `skipped` (already there), or `failed` with the reason. */
function filePayload(file: InitFile): Record<string, string> {
  switch (file.status) {
  case 'created':
    return { path: file.path, status: 'created' };
  case 'exists':
    return { path: file.path, status: 'skipped' };
  case 'failed':
    return { path: file.path, status: 'failed', reason: file.reason };
  }
}

function fileRow(file: InitFile): Row {
  switch (file.status) {
  case 'created':
    return { symbol: SYMBOLS.ok, name: file.path, state: '' };
  case 'exists':
    return { symbol: SYMBOLS.skipped, name: file.path, state: 'already there, left as it is' };
  case 'failed':
    return { symbol: SYMBOLS.failed, name: file.path, state: file.reason };
  }
}

/**
 * What to do once the files are written: go into the folder, install, fill in .env, then check the connection. When
 * `.claude/settings.json` was already there, init left it as it is: one more step says how to wire the hook into it.
 */
function nextSteps(folder: string, files: InitFile[]): string[] {
  const enter = folder === '.' ? [] : [`cd ${folder}`];
  const settingsKept = files.some((file) => file.path === SETTINGS_PATH && file.status === 'exists');
  const hook = settingsKept
    ? [`${SETTINGS_PATH} was already there: to guard the agent, add this entry to its "hooks" → "PreToolUse" list: ${HOOK_ENTRY}`]
    : [];
  return [...enter, 'npm install', 'cp .env.example .env, then fill in N8N_URL and N8N_API_KEY', ...hook, 'npx lift ping'];
}
