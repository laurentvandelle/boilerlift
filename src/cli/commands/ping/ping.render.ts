import { Row, SYMBOLS, header, next, rows, sections, warning } from '#src/cli/output.render';
import { TargetRun } from '#src/cli/targets.render';
import { connectionExitCode } from '#src/cli/exit-codes';
import { Target } from '#src/core/config/config.model';
import { CHECK_LABELS } from '#src/core/connection/check-connection';
import { Check, ConnectionReport } from '#src/core/connection/connection.model';

const STATUS_SYMBOLS: Record<Check['status'], Row['symbol']> = { ok: SYMBOLS.ok, failed: SYMBOLS.failed, skipped: SYMBOLS.skipped };

/** The ping of one target: the configuration it read, one line per check, then the summary. The API key never shows. */
export function renderTargetReport(target: Target, report: ConnectionReport): TargetRun {
  const { url, apiKey } = target.connection;
  const top = [
    header('lift ping', target.name),
    `  URL      ${url.value} (from ${url.source})`,
    `  API key  •••• (set, from ${apiKey.source})`,
    ...report.warnings.map((text) => `  ${warning(text)}`),
  ];
  const checks = rows(
    report.checks.map((check) => ({
      symbol: STATUS_SYMBOLS[check.status],
      name: CHECK_LABELS[check.name],
      state: check.detail,
      followUps: check.status === 'failed' ? [next(check.hint)] : [],
    })),
  );
  const exitCode = connectionExitCode(report);
  const failures = report.checks.filter((check) => check.status === 'failed').length;
  const summary =
    failures === 0
      ? 'All checks passed.'
      : `${failures} check${failures === 1 ? '' : 's'} failed. Exit code ${exitCode}.`;
  return {
    target: target.name,
    url: url.value,
    text: {
      exitCode,
      stdout: sections(top, checks, [summary]),
      stderr: failures === 0 ? '' : sections([summary]),
    },
    payload: {
      url: url.value,
      apiKey: { set: true, source: apiKey.source },
      checks: report.checks.map((check) => ({
        name: check.name,
        status: check.status,
        detail: check.detail,
        ...(check.status === 'failed' ? { hint: check.hint } : {}),
      })),
      warnings: report.warnings,
      exitCode,
    },
    outcome: summary,
  };
}
