import { TargetRun } from '#src/cli/targets.render';
import { Target } from '#src/core/config/config.model';
import { CHECK_LABELS } from '#src/core/connection/check-connection';
import { Check, ConnectionReport } from '#src/core/connection/connection.model';

const STATUS_MARKS: Record<Check['status'], string> = { ok: '✓', failed: '✗', skipped: '–' };

/** The ping of one target: the configuration it read, one line per check, then the summary. The API key never shows. */
export function renderTargetReport(target: Target, report: ConnectionReport): TargetRun {
  const { url, apiKey } = target.connection;
  const header = [
    `lift ping → ${target.name}`,
    `  URL      ${url.value} (from ${url.source})`,
    `  API key  •••• (${target.apiKeyEnv}, from ${apiKey.source})`,
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
    target: target.name,
    url: url.value,
    text: {
      exitCode: report.exitCode,
      stdout: `${header.join('\n')}\n\n${checks.join('\n')}\n\n${summary}\n`,
      stderr: failures === 0 ? '' : `${summary}\n`,
    },
    payload: {
      url: url.value,
      apiKey: { env: target.apiKeyEnv, source: apiKey.source },
      checks: report.checks.map((check) => ({
        name: check.name,
        status: check.status,
        detail: check.detail,
        ...(check.status === 'failed' ? { hint: check.hint } : {}),
      })),
      warnings: report.warnings,
      exitCode: report.exitCode,
    },
    outcome: summary,
  };
}
