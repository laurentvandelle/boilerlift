import { TargetRun } from '#src/cli/targets.render';
import { SyncReport } from '#src/core/credentials/credentials.model';

/** The target a report is about: its name and the url of its instance. */
export interface SyncTarget {
  name: string;
  instance: string;
}

/**
 * The sync of one target: the success line, then one line per missing key, or the failure and its next step. The
 * --json payload holds the list written and `missing`, or the error.
 */
export function renderSync(target: SyncTarget, report: SyncReport): TargetRun {
  if (report.status === 'failed') {
    const { error } = report;
    const where = error.kind === 'write-failed' ? error.path : error.call;
    const message = `Cannot sync the credentials of ${target.name}: ${where} → ${error.detail}\n  → ${error.hint}\n`;
    return {
      target: target.name,
      url: target.instance,
      text: { exitCode: report.exitCode, stdout: '', stderr: message },
      payload: {
        url: target.instance,
        error: { kind: error.kind, ...(error.kind === 'write-failed' ? { path: error.path } : { call: error.call }), detail: error.detail, hint: error.hint },
        exitCode: report.exitCode,
      },
      outcome: `Failed: ${error.detail}`,
    };
  }
  const synced = `Synced ${report.credentials.length} credentials from ${target.name}.`;
  const empty = report.credentials.length === 0 ? [`The instance of ${target.name} has no credentials.`] : [];
  const missing = report.missing.map(
    ({ key, type, workflows }) => `Missing on ${target.name}: ${key} (${type ?? 'unknown type'}), used by: ${workflows.join(', ')}`,
  );
  const lines = [synced, ...empty, `Wrote ${report.file}.`, ...missing];
  const summary = `${report.missing.length} missing on ${target.name}. Exit code ${report.exitCode}.`;
  return {
    target: target.name,
    url: target.instance,
    text: {
      exitCode: report.exitCode,
      stdout: `${lines.join('\n')}\n`,
      stderr: report.missing.length === 0 ? '' : `${summary}\n`,
    },
    payload: {
      url: target.instance,
      file: report.file,
      credentials: report.credentials,
      missing: report.missing.map(({ key, type, workflows }) => ({ key, type: type ?? null, workflows })),
      exitCode: report.exitCode,
    },
    outcome: report.missing.length === 0 ? synced : `${synced} ${summary}`,
  };
}
