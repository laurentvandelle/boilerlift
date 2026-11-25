import { describe, expect, test } from 'vitest';
import { deployErrorExitCode, runEndExitCode } from '#src/cli/exit-codes';
import { DeployError, DeployErrorKind } from '#src/core/deliver/deploy.model';

function deployError(kind: Exclude<DeployErrorKind, 'credentials-missing'>): DeployError {
  return { kind, call: 'GET /api/v1/workflows', detail: 'boom', hint: 'fix it' };
}

describe('deployErrorExitCode', () => {
  test.each<[DeployErrorKind, number]>([
    ['unreachable', 3],
    ['key-rejected', 4],
    ['workflow-failed', 5],
    ['drafts-unsupported', 6],
    ['lock-write-failed', 7],
    ['credentials-missing', 8],
    ['credential-scope-missing', 9],
  ])('Should exit %s with %s when deploy stops on that error', (kind, exitCode) => {
    expect(deployErrorExitCode(kind)).toBe(exitCode);
  });
});

describe('runEndExitCode', () => {
  test('Should exit 0 when the run completed', () => {
    expect(runEndExitCode({ outcome: 'completed' })).toBe(0);
  });

  test('Should exit 5 when a workflow failed and the run went to the end', () => {
    expect(runEndExitCode({ outcome: 'partial' })).toBe(5);
  });

  test('Should exit with the code of its error when the run stopped', () => {
    expect(runEndExitCode({ outcome: 'stopped', error: deployError('lock-write-failed') })).toBe(7);
  });
});
