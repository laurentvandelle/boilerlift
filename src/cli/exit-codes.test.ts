import { describe, expect, test } from 'vitest';
import { checkFailureExitCode, connectionExitCode, deployErrorExitCode, outcomeExitCode, readErrorExitCode, runEndExitCode, statusExitCode } from '#src/cli/exit-codes';
import { Check, CheckFailure } from '#src/core/connection/connection.model';
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

describe('checkFailureExitCode', () => {
  test.each<[CheckFailure, number]>([
    ['node-too-old', 2],
    ['unreachable', 3],
    ['key-rejected', 4],
  ])('Should exit %s with %s when a ping check fails that way', (failure, exitCode) => {
    expect(checkFailureExitCode(failure)).toBe(exitCode);
  });
});

describe('connectionExitCode', () => {
  test('Should exit 0 when every check passed', () => {
    expect(connectionExitCode({ checks: [{ name: 'node', status: 'ok', detail: '24.1.0' }], warnings: [] })).toBe(0);
  });

  test('Should exit with the code of the failed check when one check failed', () => {
    const checks: Check[] = [
      { name: 'node', status: 'ok', detail: '24.1.0' },
      { name: 'url', status: 'ok', detail: 'reachable' },
      { name: 'apiKey', status: 'failed', detail: 'rejected', hint: 'fix it', failure: 'key-rejected' },
    ];

    expect(connectionExitCode({ checks, warnings: [] })).toBe(4);
  });
});

describe('outcomeExitCode', () => {
  test.each<['completed' | 'partial', number]>([
    ['completed', 0],
    ['partial', 5],
  ])('Should exit %s with %s when the writes went to the end', (outcome, exitCode) => {
    expect(outcomeExitCode(outcome)).toBe(exitCode);
  });
});

describe('readErrorExitCode', () => {
  test.each<['unreachable' | 'key-rejected' | 'read-failed', number]>([
    ['unreachable', 3],
    ['key-rejected', 4],
    ['read-failed', 3],
  ])('Should exit %s with %s when a read stops the command', (kind, exitCode) => {
    expect(readErrorExitCode(kind)).toBe(exitCode);
  });
});

describe('statusExitCode', () => {
  test('Should exit 0 when status read everything', () => {
    expect(statusExitCode({ workflows: [] })).toBe(0);
  });

  test('Should exit 4 when a read stopped status on a rejected API key', () => {
    expect(statusExitCode({ workflows: [], error: { kind: 'key-rejected', call: 'GET /api/v1/workflows', detail: 'HTTP 401' } })).toBe(4);
  });
});
