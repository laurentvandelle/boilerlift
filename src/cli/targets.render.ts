import { CliResult } from '#src/cli/cli.model';
import { SYMBOLS, next, rows, sections } from '#src/cli/output.render';
import { EXIT_OK, EXIT_USAGE, ExitCode } from '#src/cli/exit-codes';
import { credentialsFilePath } from '#src/core/compile/credential-lists';
import { LoadProblem } from '#src/core/compile/workflow.model';
import { describeConfigError } from '#src/core/config/config-error';
import { ConfigError } from '#src/core/config/config.model';
import { CONFIG_FILE, availableTargets } from '#src/core/config/project-config';
import { LOCK_FILE } from '#src/core/lock/lock-file';
import { CredentialError, UnresolvedCredential } from '#src/core/deliver/deploy.model';
import { LockFileError } from '#src/core/lock/lock-file.model';
import { API_PATH } from '#src/core/n8n/n8n-api';

/** The help section of every command that runs on targets: where they are declared, and how one is picked. */
export const TARGETS_HELP = `Targets (declared in ./${CONFIG_FILE}):
  url     Root URL of the n8n instance (Boilerlift adds ${API_PATH})
  apiKey  Its n8n API key (n8n → Settings → n8n API). Read it from the environment in the
          file, for example process.env.N8N_API_KEY: the variables of ./.env are loaded
          first, and a variable already set in the environment wins.
With one target declared, the command runs on it. With several, name one with --target,
or run on every one in turn with --all.`;

/** What a command that runs on targets produced for one of them: its text, its --json payload and its recap line. */
export interface TargetRun {
  target: string;
  url: string;
  /** The output of this target alone, as the command prints it without --all. */
  text: CliResult;
  /** The --json payload of this target, without the `target` field. */
  payload: Record<string, unknown>;
  /** What happened, in a few words, for the recap line of --all. */
  outcome: string;
}

/** How the runs are printed: as JSON, and as one block per target with a recap (`--all`). */
export interface TargetsFormat {
  json: boolean;
  all: boolean;
}

/** The target a run is about: its name and the url of its instance. */
export interface TargetPlace {
  name: string;
  instance: string;
}

/**
 * How a command words a stop before any call to n8n: `message` closes stderr and the --json error, `outcome` is the
 * recap line of --all.
 */
export interface StopWording {
  message: string;
  outcome: string;
}

/** Workflow files that do not load: exit 1, one line per problem on stderr, then the message. */
export function renderInvalidFiles(target: TargetPlace, problems: LoadProblem[], wording: StopWording): TargetRun {
  const { message, outcome } = wording;
  const lines = rows(problems.map((problem) => ({ symbol: SYMBOLS.failed, name: problem.path, state: problem.detail })));
  return {
    target: target.name,
    url: target.instance,
    text: { exitCode: EXIT_USAGE, stdout: '', stderr: sections(lines, [message]) },
    payload: {
      instance: target.instance,
      error: { kind: 'invalid-files', message, problems: problems.map(({ path, detail }) => ({ path, detail })) },
      exitCode: EXIT_USAGE,
    },
    outcome,
  };
}

/**
 * A lock file that cannot be read: exit 1, the problem and the fix on stderr, then the message. `rerun` is the command
 * the fix names, as in `then run lift clean again`.
 */
export function renderInvalidLockFile(target: TargetPlace, error: LockFileError, wording: StopWording & { rerun: string }): TargetRun {
  const { message, outcome, rerun } = wording;
  const fix = next(`Fix the file, or restore it from version control, then run ${rerun} again.`);
  return {
    target: target.name,
    url: target.instance,
    text: {
      exitCode: EXIT_USAGE,
      stdout: '',
      stderr: sections(rows([{ symbol: SYMBOLS.failed, name: LOCK_FILE, state: error.detail, followUps: [fix] }]), [message]),
    },
    payload: { instance: target.instance, error: { kind: 'invalid-lock-file', message, detail: error.detail }, exitCode: EXIT_USAGE },
    outcome,
  };
}

/** Why a credential is missing on `target`, as the line under the stop says it. */
function missingReason(target: string, credential: UnresolvedCredential): string {
  const file = credentialsFilePath(target);
  switch (credential.reason) {
  case 'not-listed':
    return `not in ${file}`;
  case 'gone':
    return `id ${credential.id ?? ''} in ${file}, gone from the instance`;
  case 'type-changed':
    return `id ${credential.id ?? ''} in ${file}, of another type on the instance`;
  }
}

/**
 * One line per credential missing on `target`, under the stop of deploy, status or publish: its key, type, reason and
 * the workflows that use it.
 */
export function missingCredentialLines(target: string, missing: readonly UnresolvedCredential[]): string[] {
  return missing.map((credential) => `${credential.key} (${credential.type ?? 'type unknown'})  ${missingReason(target, credential)}; used by ${credential.workflows.join(', ')}`);
}

/** Each missing credential as the --json `error.missing` lists it. */
export function missingCredentialsPayload(missing: readonly UnresolvedCredential[]): Record<string, unknown>[] {
  return missing.map(({ key, type, reason, id, workflows }) => ({ key, type: type ?? null, reason, id: id ?? null, workflows }));
}

/**
 * The lines under the stop of a credential error in status or publish: each missing credential, then the hint. With
 * the --json `error` (its `next`: `lift creds sync` for missing credentials, null for a missing scope).
 */
export function credentialStop(target: string, error: CredentialError): { lines: string[]; payload: Record<string, unknown> } {
  const { kind, call, detail, hint } = error;
  switch (error.kind) {
  case 'credentials-missing':
    return {
      lines: [...missingCredentialLines(target, error.missing), next(hint)],
      payload: { kind, call, detail, hint, missing: missingCredentialsPayload(error.missing), next: `lift creds sync --target ${target}` },
    };
  case 'credential-scope-missing':
    return { lines: [next(hint)], payload: { kind, call, detail, hint, next: null } };
  }
}

/** Targets that cannot be used: exit 1, nothing ran. With --json, the error and the declared targets on stdout too. */
export function renderConfigError(error: ConfigError, format: { json: boolean }): CliResult {
  const next = error.kind === 'target-required' ? 'Name one with --target <name>, or run on every one with --all.\n' : '';
  const message = `${describeConfigError(error)}${next}`;
  if (!format.json) {
    return { exitCode: EXIT_USAGE, stdout: '', stderr: message };
  }
  const payload = {
    error: { kind: error.kind, message: message.trimEnd() },
    availableTargets: availableTargets(error),
    exitCode: EXIT_USAGE,
  };
  return { exitCode: EXIT_USAGE, stdout: `${JSON.stringify(payload, null, 2)}\n`, stderr: message };
}

/**
 * The output of a command over its targets. One target: its own output, the --json payload naming the target.
 * --all: one block per target, headed by its name and URL, a blank line between two blocks, then a recap line per
 * target (`✓` exit 0, `✗` otherwise); the exit code is the worst
 * of them (the highest).
 */
export function renderTargets(runs: TargetRun[], format: TargetsFormat): CliResult {
  const [first] = runs;
  if (!format.all && runs.length === 1 && first !== undefined) {
    return format.json ? json({ target: first.target, ...first.payload }, first.text.exitCode) : first.text;
  }
  const exitCode = worstExitCode(runs);
  if (format.json) {
    return json({ targets: runs.map((run) => ({ target: run.target, ...run.payload })), exitCode }, exitCode);
  }
  const blocks = runs.map((run) => `── ${run.target} (${run.url})\n${run.text.stdout}`);
  const nameWidth = Math.max(...runs.map((run) => run.target.length));
  const urlWidth = Math.max(...runs.map((run) => run.url.length));
  const recap = runs.map(
    (run) => `  ${run.text.exitCode === EXIT_OK ? SYMBOLS.ok : SYMBOLS.failed} ${run.target.padEnd(nameWidth)}  ${run.url.padEnd(urlWidth)}  ${run.outcome}`,
  );
  const stderr = runs
    .filter((run) => run.text.stderr !== '')
    .map((run) => `── ${run.target} (${run.url})\n${run.text.stderr}`)
    .join('\n');
  return { exitCode, stdout: `${blocks.join('\n')}\nTargets:\n${recap.join('\n')}\n`, stderr };
}

function worstExitCode(runs: TargetRun[]): ExitCode {
  return runs.reduce<ExitCode>((worst, run) => (run.text.exitCode > worst ? run.text.exitCode : worst), EXIT_OK);
}

function json(payload: Record<string, unknown>, exitCode: ExitCode): CliResult {
  return { exitCode, stdout: `${JSON.stringify(payload, null, 2)}\n`, stderr: '' };
}
