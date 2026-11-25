import { describe, expect, test } from 'vitest';
import { fakeLocalWorkflow } from '#src/core/compile/workflow.fake';
import { LocalWorkflow, StableName } from '#src/core/compile/workflow.model';
import { deploy, previewDeploy } from '#src/core/deliver/deploy';
import { DeployReport } from '#src/core/deliver/deploy.model';
import { FakeLockWriter, fakeLockWriter, fakeManaged } from '#src/core/lock/lock-file.fake';
import { FakeN8n, FakeN8nOptions, fakeN8n, fakeN8nWorkflow, httpError, unreachable } from '#src/core/n8n/n8n.fake';
import { WorkflowId } from '#src/core/n8n/n8n.model';

const CRM = fakeLocalWorkflow('crm-import');
const REPORT = fakeLocalWorkflow('daily-report');
const ARCHIVED = fakeLocalWorkflow('lead-scoring');
const NEW = fakeLocalWorkflow('invoice-sync');
const HAND_ADDED = { id: 'h', name: 'hand-added' };
const SALES_PROD = { id: 'sp', name: 'boilerlift:sales-prod' };

/** CRM is changed and carries a hand-added tag, REPORT is unchanged, ARCHIVED is archived, NEW is not on the instance. */
function mixedInstance(options: FakeN8nOptions = {}): FakeN8n {
  return fakeN8n({
    workflows: [
      fakeN8nWorkflow(CRM, { id: 'crm1', name: 'CRM (old)', tags: [HAND_ADDED] }),
      fakeN8nWorkflow(REPORT, { id: 'rep1' }),
      fakeN8nWorkflow(ARCHIVED, { id: 'lead1', isArchived: true }),
    ],
    ...options,
  });
}

const MIXED_IDS = { 'crm-import': 'crm1', 'daily-report': 'rep1', 'lead-scoring': 'lead1' };

interface RunOptions {
  workflows?: LocalWorkflow[];
  managed?: Map<StableName, WorkflowId>;
  /** The target turns the tag off. */
  tagOff?: boolean;
  lock?: FakeLockWriter;
}

/** Deploys to `n8n` as the target `sales-prod`, tagged `boilerlift:sales-prod`: every workflow of the mixed instance plus NEW, unless the test says otherwise. */
function run(
  n8n: FakeN8n,
  { workflows = [CRM, REPORT, ARCHIVED, NEW], managed = fakeManaged(MIXED_IDS), tagOff = false, lock = fakeLockWriter({ entries: MIXED_IDS }) }: RunOptions = {},
): Promise<DeployReport> {
  return deploy({ workflows, target: 'dev', credentials: [], client: n8n.client, managed, ...(tagOff ? {} : { targetTag: 'boilerlift:sales-prod' }) }, lock.writer);
}

function tagsOf(n8n: FakeN8n): Record<string, string[]> {
  return Object.fromEntries(n8n.workflows.map(({ id, tags }) => [id, tags.map(({ name }) => name)]));
}

describe('target tag', () => {
  test('Should add the target tag to every delivered workflow when the target keeps its tag', async () => {
    const n8n = mixedInstance();

    const report = await run(n8n);

    expect({ tags: tagsOf(n8n), tag: report.tag }).toEqual({
      tags: { crm1: ['hand-added', 'boilerlift:sales-prod'], rep1: ['boilerlift:sales-prod'], lead1: ['boilerlift:sales-prod'], w1: ['boilerlift:sales-prod'] },
      tag: { name: 'boilerlift:sales-prod', added: 4 },
    });
  });

  test('Should keep every action as it is when it adds the target tag', async () => {
    const n8n = mixedInstance();

    const report = await run(n8n);

    expect(report.results.map(({ stableName, action }) => [stableName, action])).toEqual([
      ['crm-import', 'updated'],
      ['daily-report', 'skipped'],
      ['invoice-sync', 'created'],
      ['lead-scoring', 'restored'],
    ]);
  });

  test('Should create the tag once when the instance has no tag named after the target', async () => {
    const n8n = mixedInstance();

    await run(n8n);

    expect({ creates: n8n.calls.filter((call) => call === 'POST /api/v1/tags'), tags: n8n.tags.map(({ name }) => name) }).toEqual({
      creates: ['POST /api/v1/tags'],
      tags: ['hand-added', 'boilerlift:sales-prod'],
    });
  });

  test('Should reuse the tag of the instance when one is named after the target', async () => {
    const n8n = mixedInstance({ tags: [SALES_PROD] });

    await run(n8n);

    expect({ created: n8n.calls.includes('POST /api/v1/tags'), crm: n8n.workflows[0]?.tags }).toEqual({
      created: false,
      crm: [HAND_ADDED, SALES_PROD],
    });
  });

  test('Should make no tag write for a workflow when it already has the target tag', async () => {
    const n8n = mixedInstance({ workflows: [fakeN8nWorkflow(REPORT, { id: 'rep1', tags: [SALES_PROD] }), fakeN8nWorkflow(CRM, { id: 'crm1' })] });

    const report = await run(n8n, { workflows: [CRM, REPORT] });

    expect({ writes: n8n.calls.filter((call) => call.startsWith('PUT ') && call.endsWith('/tags')), tag: report.tag }).toEqual({
      writes: ['PUT /api/v1/workflows/crm1/tags'],
      tag: { name: 'boilerlift:sales-prod', added: 1 },
    });
  });

  test('Should call no tag endpoint when every delivered workflow already has the target tag', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(REPORT, { id: 'rep1', tags: [SALES_PROD] })] });

    const report = await run(n8n, { workflows: [REPORT], managed: fakeManaged({ 'daily-report': 'rep1' }) });

    expect({ calls: n8n.calls, tag: report.tag }).toEqual({
      calls: ['GET /api/v1/openapi.yml', 'GET /api/v1/workflows/rep1'],
      tag: { name: 'boilerlift:sales-prod', added: 0 },
    });
  });

  test('Should make no tag call and report the same actions when the target turns the tag off', async () => {
    const tagged = mixedInstance();
    const untagged = mixedInstance();
    const withTag = await run(tagged);

    const report = await run(untagged, { tagOff: true });

    expect({
      tagCalls: untagged.calls.filter((call) => call.includes('/tags')),
      tag: report.tag,
      results: report.results,
      outcome: report.outcome,
      lockFile: report.lockFile,
    }).toEqual({ tagCalls: [], tag: undefined, results: withTag.results, outcome: withTag.outcome, lockFile: withTag.lockFile });
  });

  test('Should not tag a workflow when it failed', async () => {
    const n8n = mixedInstance({ failures: [httpError('PUT /api/v1/workflows/crm1', 500, 'boom')] });

    await run(n8n, { workflows: [CRM] });

    expect(n8n.calls.filter((call) => call.includes('/tags'))).toEqual([]);
  });

  test('Should warn, keep the action and the outcome when the instance refuses to add the tag to a workflow', async () => {
    const n8n = mixedInstance({ failures: [httpError('PUT /api/v1/workflows/rep1/tags', 403, 'Forbidden')] });

    const report = await run(n8n, { workflows: [CRM, REPORT] });

    expect({ warnings: report.warnings, outcome: report.outcome, report: report.results[1]?.action, tag: report.tag }).toEqual({
      warnings: [{ kind: 'tag-failed', stableName: 'daily-report', tag: 'boilerlift:sales-prod', call: 'PUT /api/v1/workflows/rep1/tags', detail: 'HTTP 403: Forbidden' }],
      outcome: 'completed',
      report: 'skipped',
      tag: { name: 'boilerlift:sales-prod', added: 1 },
    });
  });

  test('Should warn on every workflow and still record the created one when the tag cannot be created', async () => {
    const n8n = fakeN8n({ failures: [httpError('POST /api/v1/tags', 403, 'Forbidden')] });
    const lock = fakeLockWriter();

    const report = await run(n8n, { workflows: [NEW, REPORT], managed: fakeManaged(), lock });

    expect({ warnings: report.warnings.map(({ stableName }) => stableName), outcome: report.outcome, recorded: lock.recorded() }).toEqual({
      warnings: ['daily-report', 'invoice-sync'],
      outcome: 'completed',
      recorded: { 'daily-report': 'w1', 'invoice-sync': 'w2' },
    });
  });

  test('Should warn with the reason when the tags cannot be listed', async () => {
    const n8n = fakeN8n({ failures: [unreachable('GET /api/v1/tags', 'connection reset')] });

    const report = await run(n8n, { workflows: [NEW], managed: fakeManaged() });

    expect({ warnings: report.warnings, outcome: report.outcome }).toEqual({
      warnings: [{ kind: 'tag-failed', stableName: 'invoice-sync', tag: 'boilerlift:sales-prod', call: 'GET /api/v1/tags', detail: 'unreachable: connection reset' }],
      outcome: 'completed',
    });
  });

  test('Should add no tag when the run stopped', async () => {
    const n8n = fakeN8n({ failures: [httpError('POST /api/v1/workflows', 401)] });

    const report = await run(n8n, { workflows: [NEW], managed: fakeManaged() });

    expect({ tagCalls: n8n.calls.filter((call) => call.includes('/tags')), tag: report.tag }).toEqual({
      tagCalls: [],
      tag: { name: 'boilerlift:sales-prod', added: 0 },
    });
  });
});

describe('target tag in a dry run', () => {
  test('Should count the workflows that would receive the target tag and write nothing when it previews a deploy', async () => {
    const n8n = mixedInstance({ workflows: [fakeN8nWorkflow(REPORT, { id: 'rep1', tags: [SALES_PROD] }), fakeN8nWorkflow(CRM, { id: 'crm1' })] });

    const report = await previewDeploy({ workflows: [CRM, REPORT, NEW], target: 'dev', credentials: [], client: n8n.client, managed: fakeManaged(MIXED_IDS), targetTag: 'boilerlift:sales-prod' });

    expect({ tag: report.tag, readOnly: n8n.calls.every((call) => call.startsWith('GET ')), tagCalls: n8n.calls.filter((call) => call.includes('/tags')) }).toEqual({
      tag: { name: 'boilerlift:sales-prod', added: 2 },
      readOnly: true,
      tagCalls: [],
    });
  });

  test('Should report no target tag when it previews a deploy to a target that turns the tag off', async () => {
    const n8n = mixedInstance();

    const report = await previewDeploy({ workflows: [CRM], target: 'dev', credentials: [], client: n8n.client, managed: fakeManaged(MIXED_IDS) });

    expect(report.tag).toBeUndefined();
  });
});
