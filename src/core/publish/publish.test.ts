import { describe, expect, test } from 'vitest';
import { StableName } from '#src/core/compile/workflow.model';
import { fakeLocalWorkflow, fakeNode, fakeStableName } from '#src/core/compile/workflow.fake';
import { FakeN8n, fakeN8n, fakeN8nWorkflow, fakeWorkflowId, httpError, unreachable } from '#src/core/n8n/n8n.fake';
import { WorkflowId } from '#src/core/n8n/n8n.model';
import { applyPublish, planPublish } from '#src/core/publish/publish';

const CRM = fakeLocalWorkflow('crm-import');
const REPORT = fakeLocalWorkflow('daily-report');
const WEEKLY = fakeLocalWorkflow('weekly');
const ARCHIVED = fakeLocalWorkflow('old-sync');
const NEW = fakeLocalWorkflow('invoice-sync');
const WORKFLOWS = [CRM, REPORT, WEEKLY, ARCHIVED, NEW];

/** CRM differs, REPORT is a draft not yet published, WEEKLY is up to date, ARCHIVED is archived, NEW is not deployed. */
function instance(): FakeN8n {
  return fakeN8n({
    workflows: [
      fakeN8nWorkflow(CRM, { id: 'crm1', nodes: [fakeNode({ name: 'Changed in n8n' })] }),
      fakeN8nWorkflow(REPORT, { id: 'rep1', versionId: 'v2', activeVersionId: 'v1' }),
      fakeN8nWorkflow(WEEKLY, { id: 'wk1' }),
      fakeN8nWorkflow(ARCHIVED, { id: 'old1', isArchived: true }),
    ],
  });
}

function managed(): Map<StableName, WorkflowId> {
  return new Map(
    Object.entries({ 'crm-import': 'crm1', 'daily-report': 'rep1', weekly: 'wk1', 'old-sync': 'old1' }).map(([name, id]) => [
      fakeStableName(name),
      fakeWorkflowId(id),
    ]),
  );
}

describe('planPublish', () => {
  test('Should plan only the drafts waiting to be published when no name is given', async () => {
    const n8n = instance();

    const plan = await planPublish({ workflows: WORKFLOWS, client: n8n.client, managed: managed(), names: [] });

    expect(plan).toEqual({ kind: 'ready', workflows: [expect.objectContaining({ stableName: 'daily-report', id: 'rep1', action: 'to-publish' })] });
  });

  test('Should refuse a differing workflow and skip an up-to-date one when they are named', async () => {
    const n8n = instance();

    const plan = await planPublish({ workflows: WORKFLOWS, client: n8n.client, managed: managed(), names: ['weekly', 'crm-import', 'daily-report'] });

    expect(plan).toEqual({
      kind: 'ready',
      workflows: [
        expect.objectContaining({ stableName: 'crm-import', action: 'refused' }),
        expect.objectContaining({ stableName: 'daily-report', action: 'to-publish' }),
        expect.objectContaining({ stableName: 'weekly', action: 'already-published' }),
      ],
    });
  });

  test('Should report every unknown name with its reason when a name matches no file, no recorded id or an archived workflow', async () => {
    const n8n = instance();

    const plan = await planPublish({ workflows: WORKFLOWS, client: n8n.client, managed: managed(), names: ['daily-report', 'nope', 'invoice-sync', 'old-sync'] });

    expect(plan).toEqual({
      kind: 'unknown-names',
      unknown: [
        { name: 'invoice-sync', reason: 'not-deployed' },
        { name: 'nope', reason: 'no-file' },
        { name: 'old-sync', reason: 'archived' },
      ],
    });
  });

  test('Should stop with the failed read when the instance cannot be reached', async () => {
    const n8n = fakeN8n({ failures: [unreachable('GET /api/v1/workflows/rep1', 'connection refused')] });

    const plan = await planPublish({ workflows: [REPORT], client: n8n.client, managed: managed(), names: [] });

    expect(plan).toMatchObject({ kind: 'stopped', exitCode: 3, error: { kind: 'unreachable', call: 'GET /api/v1/workflows/rep1' } });
  });
});

describe('applyPublish', () => {
  test('Should make the draft the published version when it publishes a workflow', async () => {
    const n8n = instance();
    const plan = await planPublish({ workflows: WORKFLOWS, client: n8n.client, managed: managed(), names: [] });

    const report = await applyPublish(plan.kind === 'ready' ? plan.workflows : [], n8n.client);

    expect(report).toEqual({ results: [expect.objectContaining({ stableName: 'daily-report', action: 'published' })], exitCode: 0 });
    expect(n8n.workflows.find((workflow) => workflow.id === 'rep1')).toMatchObject({ versionId: 'v2', activeVersionId: 'v2' });
  });

  test('Should still publish the others and exit 5 when n8n rejects one workflow', async () => {
    const other = fakeLocalWorkflow('other');
    const n8n = fakeN8n({
      workflows: [
        fakeN8nWorkflow(REPORT, { id: 'rep1', versionId: 'v2', activeVersionId: 'v1' }),
        fakeN8nWorkflow(other, { id: 'oth1', versionId: 'v2', activeVersionId: null }),
      ],
      failures: [httpError('POST /api/v1/workflows/oth1/activate', 400, 'Workflow has no node to start the workflow')],
    });
    const plan = await planPublish({
      workflows: [REPORT, other],
      client: n8n.client,
      managed: new Map([
        [fakeStableName('daily-report'), fakeWorkflowId('rep1')],
        [fakeStableName('other'), fakeWorkflowId('oth1')],
      ]),
      names: [],
    });

    const report = await applyPublish(plan.kind === 'ready' ? plan.workflows : [], n8n.client);

    expect(report).toEqual({
      results: [
        expect.objectContaining({ stableName: 'daily-report', action: 'published' }),
        expect.objectContaining({
          stableName: 'other',
          action: 'failed',
          error: { kind: 'rejected', call: 'POST /api/v1/workflows/oth1/activate', detail: 'HTTP 400: Workflow has no node to start the workflow' },
        }),
      ],
      exitCode: 5,
    });
  });

  test('Should exit 5 and publish nothing for it when a named workflow is refused', async () => {
    const n8n = instance();
    const plan = await planPublish({ workflows: WORKFLOWS, client: n8n.client, managed: managed(), names: ['crm-import'] });

    const report = await applyPublish(plan.kind === 'ready' ? plan.workflows : [], n8n.client);

    expect(report).toEqual({ results: [expect.objectContaining({ stableName: 'crm-import', action: 'refused' })], exitCode: 5 });
    expect(n8n.calls.filter((call) => call.endsWith('/activate'))).toEqual([]);
  });
});
