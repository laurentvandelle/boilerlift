import { CliResult, TemplateFetchError } from '#src/cli/cli.model';
import { InitFile, InitFolder, InitOutput } from '#src/cli/commands/init/init.model';
import { Row, SYMBOLS, next, rows, sections } from '#src/cli/output.render';
import { EXIT_INIT_WRITE_FAILED, EXIT_OK, EXIT_USAGE, ExitCode, FailureExitCode, templateFetchExitCode } from '#src/cli/exit-codes';

/** Printed before the next steps: the project is not usable until they are run. */
export const NEXT_STEPS_HEADING = 'The project is not ready yet. Run these commands, in order, to finish the setup:';

/** The guide for a project that already exists: create a new one with init, then move its files into it. */
export const MIGRATION_GUIDE_URL = 'https://github.com/laurentvandelle/boilerlift/blob/main/docs/migration.md';

const GIT_INSTALL_URL = 'https://git-scm.com/downloads';

const NAME_A_FOLDER = 'Name a new or empty folder, for example lift init my-workflows.';

/**
 * What init did. Written: the files of the project, one row each (`✓` created, `✗` failed), then the next steps; a
 * failed write exits EXIT_INIT_WRITE_FAILED, with the count on stderr, and the --json payload holds the folder, the
 * files, the next steps and the exit code. A Project template it could not fetch: the reason on stderr, exit 13.
 */
export function renderInit(output: InitOutput, folder: InitFolder, format: { json: boolean }): CliResult {
  switch (output.kind) {
  case 'written':
    return renderWritten(output.files, folder, format);
  case 'template-unavailable':
    return renderTemplateUnavailable(output.error, folder, format);
  }
}

/** No folder given: exit 1, nothing written. */
export function renderNoFolder(format: { json: boolean }): CliResult {
  return failure('no-folder', 'lift init needs a folder to create the project in.', [NAME_A_FOLDER], EXIT_USAGE, format);
}

/** More than one folder given: exit 1, nothing written. */
export function renderTooManyFolders(positionals: string[], format: { json: boolean }): CliResult {
  return failure('too-many-folders', `lift init takes one folder, not ${positionals.length}: ${positionals.join(' ')}`, [NAME_A_FOLDER], EXIT_USAGE, format);
}

/** The folder given is an existing file: exit 1, nothing written. */
export function renderFolderIsFile(folder: string, format: { json: boolean }): CliResult {
  return failure('folder-is-file', `Cannot create a project in ${folder}: it is a file, not a folder.`, existingProjectHints(), EXIT_USAGE, format);
}

/** The folder given holds something other than `.git`: exit 1, nothing written. */
export function renderFolderNotEmpty(folder: string, format: { json: boolean }): CliResult {
  return failure('folder-not-empty', `Cannot create a project in ${folder}: the folder is not empty.`, existingProjectHints(), EXIT_USAGE, format);
}

function existingProjectHints(): string[] {
  return [NAME_A_FOLDER, `To bring an existing project to a new version, see ${MIGRATION_GUIDE_URL}`];
}

function renderWritten(files: InitFile[], folder: InitFolder, format: { json: boolean }): CliResult {
  const failed = files.filter((file) => file.status === 'failed');
  const exitCode: ExitCode = failed.length === 0 ? EXIT_OK : EXIT_INIT_WRITE_FAILED;
  const steps = nextSteps(folder);
  const stderr =
    failed.length === 0
      ? ''
      : sections([`${failed.length} of ${files.length} files could not be written.`], [next('Fix the cause, then run lift init again in a new or empty folder')]);
  if (format.json) {
    const payload = { folder: folder.path, files: files.map(filePayload), next: steps, exitCode };
    return { exitCode, stdout: `${JSON.stringify(payload, null, 2)}\n`, stderr };
  }
  return { exitCode, stdout: sections(rows(files.map(fileRow)), [NEXT_STEPS_HEADING, ...steps.map((step) => next(step))]), stderr };
}

/** The Project template could not be fetched: exit 13, nothing written. The message names the URL and the reason. */
function renderTemplateUnavailable(error: TemplateFetchError, folder: InitFolder, format: { json: boolean }): CliResult {
  const exitCode = templateFetchExitCode(error);
  switch (error.kind) {
  case 'git-not-found':
    return failure(error.kind, `Cannot get the Project template from ${error.url}: git not found.`, [
      `Install git (${GIT_INSTALL_URL}), then run lift init again.`,
    ], exitCode, format);
  case 'tag-not-found':
    return failure(error.kind, `Cannot get the Project template from ${error.url}: it has no tag ${error.tag}, the tag of this version of lift.`, [
      `Run a released version of lift, for example npx boilerlift@latest init ${folder.path}`,
    ], exitCode, format);
  case 'fetch-failed':
    return failure(error.kind, `Cannot get the Project template ${error.tag} from ${error.url}: ${error.reason}`, [
      'Check your network connection, then run lift init again.',
    ], exitCode, format);
  }
}

/** A stop before anything is written: the message and its hints on stderr, and with --json, the error on stdout. */
function failure(kind: string, message: string, hints: string[], exitCode: FailureExitCode, format: { json: boolean }): CliResult {
  const text = sections([message, ...hints.map((hint) => `  ${next(hint)}`)]);
  if (!format.json) {
    return { exitCode, stdout: '', stderr: text };
  }
  const payload = { error: { kind, message }, exitCode };
  return { exitCode, stdout: `${JSON.stringify(payload, null, 2)}\n`, stderr: text };
}

/** A file as --json prints it: `created`, or `failed` with the reason. */
function filePayload(file: InitFile): Record<string, string> {
  switch (file.status) {
  case 'created':
    return { path: file.path, status: 'created' };
  case 'failed':
    return { path: file.path, status: 'failed', reason: file.reason };
  }
}

function fileRow(file: InitFile): Row {
  switch (file.status) {
  case 'created':
    return { symbol: SYMBOLS.ok, name: file.path, state: '' };
  case 'failed':
    return { symbol: SYMBOLS.failed, name: file.path, state: file.reason };
  }
}

/** What to do once the files are written: go into the folder, start Git there, install, fill in .env, then ping. */
function nextSteps(folder: InitFolder): string[] {
  const enter = folder.path === '.' ? [] : [`cd ${folder.path}`];
  const git = folder.hasGit ? [] : ['git init'];
  return [...enter, ...git, 'npm install', 'cp .env.example .env, then fill in N8N_URL and N8N_API_KEY', 'npx lift ping'];
}
