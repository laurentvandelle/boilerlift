import { CliResult } from '#src/cli/cli.model';
import { describeConfigError } from '#src/core/config/config-error';
import { ConfigError, ConnectionConfig } from '#src/core/config/config.model';
import { CHECK_LABELS } from '#src/core/connection/check-connection';
import { Check, ConnectionReport } from '#src/core/connection/connection.model';
import { EXIT_USAGE } from '#src/core/common/exit-codes';

const STATUS_MARKS: Record<Check['status'], string> = { ok: '✓', failed: '✗', skipped: '–' };

/** A connection config that cannot be used: exit 1, the fix on stderr. */
export function renderConfigError(error: ConfigError): CliResult {
  return { exitCode: EXIT_USAGE, stdout: '', stderr: describeConfigError(error) };
}

/** The configuration ping read, one line per check, then the summary. */
export function renderReport(config: ConnectionConfig, report: ConnectionReport): CliResult {
  const header = [
    'n8nlift ping',
    `  URL      ${config.url.value} (from ${config.url.source})`,
    `  API key  •••• (set, from ${config.apiKey.source})`,
    ...report.warnings.map((warning) => `  ! ${warning}`),
  ];
  const width = Math.max(...Object.values(CHECK_LABELS).map((label) => label.length)) + 2;
  const checks = report.checks.flatMap((check) => {
    const line = `${STATUS_MARKS[check.status]} ${CHECK_LABELS[check.name].padEnd(width)}${check.detail}`;
    return check.status === 'failed' ? [line, `${' '.repeat(width + 2)}→ ${check.hint}`] : [line];
  });
  const failures = report.checks.filter((check) => check.status === 'failed').length;
  const summary =
    failures === 0
      ? 'All checks passed.'
      : `${failures} check${failures === 1 ? '' : 's'} failed. Exit code ${report.exitCode}.`;
  return {
    exitCode: report.exitCode,
    stdout: `${header.join('\n')}\n\n${checks.join('\n')}\n\n${summary}\n`,
    stderr: failures === 0 ? '' : `${summary}\n`,
  };
}
