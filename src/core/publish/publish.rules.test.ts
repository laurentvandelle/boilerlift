import { describe, expect, test } from 'vitest';
import { decidePublish } from '#src/core/publish/publish.rules';
import { fakeManagedStatus } from '#src/core/status/status.fake';
import { StatusReport } from '#src/core/status/status.model';

/** CRM differs, REPORT is a draft not yet published, WEEKLY is up to date, ARCHIVED is archived, NEW is not deployed. */
const REPORT: StatusReport = {
  workflows: [
    fakeManagedStatus('crm-import', 'differs', 'crm1'),
    fakeManagedStatus('daily-report', 'draft-pending', 'rep1'),
    fakeManagedStatus('invoice-sync', 'missing'),
    fakeManagedStatus('old-sync', 'archived', 'old1'),
    fakeManagedStatus('weekly', 'up-to-date', 'wk1'),
  ],
};

describe('decidePublish', () => {
  test('Should plan the drafts waiting to be published, and report the differing workflows, when no name is given', () => {
    const plan = decidePublish(REPORT, []);

    expect(plan).toEqual({
      kind: 'ready',
      workflows: [
        expect.objectContaining({ stableName: 'crm-import', id: 'crm1', action: 'differs' }),
        expect.objectContaining({ stableName: 'daily-report', id: 'rep1', action: 'to-publish' }),
      ],
    });
  });

  test('Should refuse a differing workflow and skip an up-to-date one when they are named', () => {
    const plan = decidePublish(REPORT, ['weekly', 'crm-import', 'daily-report']);

    expect(plan).toEqual({
      kind: 'ready',
      workflows: [
        expect.objectContaining({ stableName: 'crm-import', action: 'refused' }),
        expect.objectContaining({ stableName: 'daily-report', action: 'to-publish' }),
        expect.objectContaining({ stableName: 'weekly', action: 'already-published' }),
      ],
    });
  });

  test('Should plan a name once when it is given twice', () => {
    const plan = decidePublish(REPORT, ['daily-report', 'daily-report']);

    expect(plan).toEqual({ kind: 'ready', workflows: [expect.objectContaining({ stableName: 'daily-report', action: 'to-publish' })] });
  });

  test('Should report every unknown name with its reason when a name matches no file, no recorded id or an archived workflow', () => {
    const plan = decidePublish(REPORT, ['daily-report', 'nope', 'invoice-sync', 'old-sync']);

    expect(plan).toEqual({
      kind: 'unknown-names',
      unknown: [
        { name: 'invoice-sync', reason: 'not-deployed' },
        { name: 'nope', reason: 'no-file' },
        { name: 'old-sync', reason: 'archived' },
      ],
    });
  });

  test('Should stop with the error of the report when status stopped', () => {
    const error = { kind: 'key-rejected', call: 'GET /api/v1/workflows/rep1', detail: 'HTTP 401' } as const;

    const plan = decidePublish({ workflows: [], error }, []);

    expect(plan).toEqual({ kind: 'stopped', error });
  });
});
