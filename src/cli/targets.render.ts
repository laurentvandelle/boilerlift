import { CliResult } from '#src/cli/cli.model';
import { EXIT_OK, EXIT_USAGE, ExitCode } from '#src/core/common/exit-codes';
import { describeConfigError } from '#src/core/config/config-error';
import { ConfigError } from '#src/core/config/config.model';
import { availableTargets } from '#src/core/config/project-config';

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
 * --all: one block per target, headed by its name and URL, then a recap line per target; the exit code is the worst
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
    (run) => `  ${run.text.exitCode === EXIT_OK ? '✓' : '✗'} ${run.target.padEnd(nameWidth)}  ${run.url.padEnd(urlWidth)}  ${run.outcome}`,
  );
  const stderr = runs
    .filter((run) => run.text.stderr !== '')
    .map((run) => `── ${run.target} (${run.url})\n${run.text.stderr}`)
    .join('');
  return { exitCode, stdout: `${blocks.join('\n')}\nTargets:\n${recap.join('\n')}\n`, stderr };
}

function worstExitCode(runs: TargetRun[]): ExitCode {
  return runs.reduce<ExitCode>((worst, run) => (run.text.exitCode > worst ? run.text.exitCode : worst), EXIT_OK);
}

function json(payload: Record<string, unknown>, exitCode: ExitCode): CliResult {
  return { exitCode, stdout: `${JSON.stringify(payload, null, 2)}\n`, stderr: '' };
}
