import { describe, expect, test } from 'vitest';
import { fakeLocalWorkflow } from '#src/core/compile/workflow.fake';
import { LocalWorkflow, StableName } from '#src/core/compile/workflow.model';
import { planToReport } from '#src/core/deliver/apply-plan';
import { deploy } from '#src/core/deliver/deploy';
import { DeployReport } from '#src/core/deliver/deploy.model';
import { fakeLockWriter, fakeManaged } from '#src/core/deliver/lock-file.fake';
import { planDeploy } from '#src/core/deliver/plan-deploy';
import { FakeN8n, FakeN8nOptions, fakeN8n, fakeN8nWorkflow, httpError, unreachable } from '#src/core/n8n/n8n.fake';
import { ApiFailure, N8nWorkflow, WorkflowId } from '#src/core/n8n/n8n.model';

const PING_HINT = 'Run lift ping to check the url of the target and your network, then run deploy again';
const KEY_HINT = 'Create a key in n8n → Settings → n8n API, then set it as the apiKey of the target in boilerlift.config.ts, through the environment variable it reads';

function actions(report: DeployReport): string[][] {
  return report.results.map(({ stableName, action }) => [stableName, action]);
}

/** Deploys `workflows` to `n8n`, managing the ids of `managed` (stable name → id), with `lock` as the record. */
function run(
  workflows: LocalWorkflow[],
  n8n: FakeN8n,
  managed: Map<StableName, WorkflowId> = fakeManaged(),
  lock = fakeLockWriter(),
): Promise<DeployReport> {
  return deploy({ workflows, client: n8n.client, managed }, lock.writer);
}

describe('deploy', () => {
  test('Should report the workflow created with its new id when the lock file does not record it', async () => {
    const n8n = fakeN8n();

    const report = await run([fakeLocalWorkflow('invoice-sync')], n8n);

    expect(report).toEqual({
      warnings: [],
      exitCode: 0,
      lockFile: { path: 'boilerlift.lock.json', changed: true },
      results: [
        {
          stableName: 'invoice-sync',
          path: 'workflows/invoice-sync.json',
          action: 'created',
          id: 'w1',
          name: 'Workflow invoice-sync',
        },
      ],
    });
  });

  test('Should record a new workflow under the instance URL when it creates it', async () => {
    const lock = fakeLockWriter({ entries: { 'crm-import': 'abc' } });
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(fakeLocalWorkflow('crm-import'), { id: 'abc' })] });

    await run([fakeLocalWorkflow('crm-import'), fakeLocalWorkflow('invoice-sync')], n8n, lock.managed(), lock);

    expect(lock.recorded()).toEqual({ 'crm-import': 'abc', 'invoice-sync': 'w1' });
  });

  test('Should read only the spec before it creates a workflow when the lock file records nothing', async () => {
    const n8n = fakeN8n();

    await run([fakeLocalWorkflow('invoice-sync')], n8n);

    expect(n8n.calls).toEqual(['GET /api/v1/openapi.yml', 'POST /api/v1/workflows']);
  });

  test('Should update a recorded workflow by its id when it was renamed in n8n', async () => {
    const workflow = fakeLocalWorkflow('crm-import');
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(workflow, { id: 'abc', name: 'Renamed in n8n' })] });

    const report = await run([workflow], n8n, fakeManaged({ 'crm-import': 'abc' }));

    expect(report.results).toEqual([expect.objectContaining({ action: 'updated', id: 'abc' })]);
    expect(n8n.workflows).toEqual([expect.objectContaining({ id: 'abc', name: 'Workflow crm-import' })]);
  });

  test('Should never call or change a workflow on the instance when the lock file does not record it', async () => {
    const workflow = fakeLocalWorkflow('crm-import');
    const unmanaged = fakeN8nWorkflow(workflow, { id: 'other', name: 'Workflow crm-import' });
    const n8n = fakeN8n({ workflows: [unmanaged] });

    await run([workflow], n8n);

    expect(n8n.calls.filter((call) => call.includes('/other'))).toEqual([]);
    expect(n8n.workflows[0]).toEqual(unmanaged);
  });

  test('Should not write the lock file when only recorded workflows changed', async () => {
    const lock = fakeLockWriter({ entries: { a: 'ida', b: 'idb' } });
    const n8n = fakeN8n({
      workflows: [fakeN8nWorkflow(fakeLocalWorkflow('a'), { id: 'ida', name: 'Old name' }), fakeN8nWorkflow(fakeLocalWorkflow('b'), { id: 'idb' })],
    });

    const report = await run([fakeLocalWorkflow('a'), fakeLocalWorkflow('b')], n8n, lock.managed(), lock);

    expect({ saves: lock.saves(), lockFile: report.lockFile }).toEqual({ saves: 0, lockFile: { path: 'boilerlift.lock.json', changed: false } });
  });

  test('Should recreate the workflow from code and record its new id when the recorded id answers 404', async () => {
    const lock = fakeLockWriter({ entries: { 'crm-import': 'gone' } });
    const n8n = fakeN8n();

    const report = await run([fakeLocalWorkflow('crm-import')], n8n, lock.managed(), lock);

    expect(report.results).toEqual([expect.objectContaining({ action: 'recreated', previousId: 'gone', id: 'w1' })]);
    expect(lock.recorded()).toEqual({ 'crm-import': 'w1' });
  });

  test('Should never call a tag endpoint when it creates, recreates, updates and skips workflows on an instance with no tag', async () => {
    const changed = fakeLocalWorkflow('changed');
    const same = fakeLocalWorkflow('same');
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(changed, { id: 'idc', name: 'Old name' }), fakeN8nWorkflow(same, { id: 'ids' })] });

    const report = await run(
      [fakeLocalWorkflow('new'), fakeLocalWorkflow('gone'), changed, same],
      n8n,
      fakeManaged({ changed: 'idc', same: 'ids', gone: 'idg' }),
    );

    expect(actions(report)).toEqual([
      ['changed', 'updated'],
      ['gone', 'recreated'],
      ['new', 'created'],
      ['same', 'skipped'],
    ]);
    expect(n8n.calls.filter((call) => call.includes('/tags'))).toEqual([]);
  });

  test('Should leave the tags alone when it updates a workflow', async () => {
    const workflow = fakeLocalWorkflow('crm-import');
    const tags = [{ id: 'hand', name: 'hand-added' }];
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(workflow, { id: 'abc', name: 'Old name', tags })] });

    await run([workflow], n8n, fakeManaged({ 'crm-import': 'abc' }));

    expect(n8n.calls).toEqual(['GET /api/v1/openapi.yml', 'GET /api/v1/workflows/abc', 'PUT /api/v1/workflows/abc']);
    expect(n8n.workflows[0]?.tags).toEqual(tags);
  });

  test('Should skip a workflow and write nothing when its draft matches the file but for node ids and server settings', async () => {
    const workflow = fakeLocalWorkflow('daily-report');
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(workflow, { id: 'abc' })] });

    const report = await run([workflow], n8n, fakeManaged({ 'daily-report': 'abc' }));

    expect(report.results).toEqual([expect.objectContaining({ action: 'skipped', id: 'abc' })]);
    expect(n8n.calls).toEqual(['GET /api/v1/openapi.yml', 'GET /api/v1/workflows/abc']);
  });

  test('Should skip every workflow and write nothing when it deploys the same files twice', async () => {
    const n8n = fakeN8n();
    const lock = fakeLockWriter();
    const workflows = [fakeLocalWorkflow('a'), fakeLocalWorkflow('b')];
    await run(workflows, n8n, lock.managed(), lock);
    n8n.calls.length = 0;

    const report = await run(workflows, n8n, lock.managed(), lock);

    expect(actions(report)).toEqual([
      ['a', 'skipped'],
      ['b', 'skipped'],
    ]);
    expect(n8n.calls).toEqual(['GET /api/v1/openapi.yml', 'GET /api/v1/workflows/w1', 'GET /api/v1/workflows/w2']);
  });

  test('Should stop before any write with exit 6 when the spec has no publishIfActive', async () => {
    const workflow = fakeLocalWorkflow('a');
    const n8n = fakeN8n({ spec: 'paths:\n  /workflows/{id}:\n    put: {}\n', workflows: [fakeN8nWorkflow(workflow, { id: 'abc' })] });

    const report = await run([workflow, fakeLocalWorkflow('b')], n8n, fakeManaged({ a: 'abc' }));

    expect(report).toEqual({
      results: [],
      warnings: [],
      lockFile: { path: 'boilerlift.lock.json', changed: false },
      error: {
        call: 'GET /api/v1/openapi.yml',
        detail: 'the API spec has no publishIfActive: n8n 2.35.0 or later is required',
        hint: 'Upgrade the instance to n8n 2.35.0 or later, then run deploy again',
        kind: 'drafts-unsupported',
      },
      exitCode: 6,
    });
    expect(n8n.calls).toEqual(['GET /api/v1/openapi.yml']);
  });

  test.each([[404], [500]])('Should stop before any write with exit 6 when the spec answers HTTP %s', async (status) => {
    const n8n = fakeN8n({ failures: [httpError('GET /api/v1/openapi.yml', status)] });

    const report = await run([fakeLocalWorkflow('a')], n8n);

    expect(report).toMatchObject({ results: [], exitCode: 6, error: { detail: `HTTP ${status}: n8n 2.35.0 or later is required` } });
    expect(n8n.calls).toEqual(['GET /api/v1/openapi.yml']);
  });

  test('Should stop before any write with exit 3 and the ping hint when the spec cannot be reached', async () => {
    const n8n = fakeN8n({ failures: [unreachable('GET /api/v1/openapi.yml', 'connection reset')] });

    const report = await run([fakeLocalWorkflow('a')], n8n);

    expect(report).toMatchObject({ results: [], exitCode: 3, error: { hint: PING_HINT } });
    expect(n8n.calls).toEqual(['GET /api/v1/openapi.yml']);
  });

  test('Should report the workflow restored when its recorded id is archived', async () => {
    const workflow = fakeLocalWorkflow('crm');
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(workflow, { id: 'arc', name: 'Old name', isArchived: true })] });

    const report = await run([workflow], n8n, fakeManaged({ crm: 'arc' }));

    expect(report.results).toEqual([expect.objectContaining({ stableName: 'crm', action: 'restored', id: 'arc' })]);
    expect(report.exitCode).toBe(0);
  });

  test('Should leave the lock file untouched when it restores an archived workflow', async () => {
    const lock = fakeLockWriter({ entries: { crm: 'arc' } });
    const workflow = fakeLocalWorkflow('crm');
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(workflow, { id: 'arc', name: 'Old name', isArchived: true })] });

    const report = await run([workflow], n8n, lock.managed(), lock);

    expect({ saves: lock.saves(), recorded: lock.recorded(), changed: report.lockFile.changed }).toEqual({
      saves: 0,
      recorded: { crm: 'arc' },
      changed: false,
    });
  });

  test('Should warn that the workflow is back as an unpublished draft when it restores it', async () => {
    const workflow = fakeLocalWorkflow('crm');
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(workflow, { id: 'arc', isArchived: true })] });

    const report = await run([workflow], n8n, fakeManaged({ crm: 'arc' }));

    expect(report.warnings).toEqual([{ kind: 'restored', stableName: 'crm', id: 'arc' }]);
  });

  test('Should unarchive, then update as a draft when the archived workflow differs from the file', async () => {
    const workflow = fakeLocalWorkflow('crm');
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(workflow, { id: 'arc', name: 'Old name', isArchived: true })] });

    await run([workflow], n8n, fakeManaged({ crm: 'arc' }));

    expect(n8n.calls).toEqual([
      'GET /api/v1/openapi.yml',
      'GET /api/v1/workflows/arc',
      'POST /api/v1/workflows/arc/unarchive',
      'GET /api/v1/workflows/arc',
      'PUT /api/v1/workflows/arc',
    ]);
    expect(n8n.workflows[0]).toMatchObject({ isArchived: false, name: 'Workflow crm' });
  });

  test('Should restore without an update when the archived workflow already matches the file', async () => {
    const workflow = fakeLocalWorkflow('crm');
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(workflow, { id: 'arc', isArchived: true })] });

    const report = await run([workflow], n8n, fakeManaged({ crm: 'arc' }));

    expect(report.results).toEqual([expect.objectContaining({ action: 'restored', id: 'arc' })]);
    expect(n8n.calls).not.toContain('PUT /api/v1/workflows/arc');
  });

  test('Should fail only that workflow with the scope hint when the instance refuses to unarchive it', async () => {
    const workflow = fakeLocalWorkflow('crm');
    const n8n = fakeN8n({
      workflows: [fakeN8nWorkflow(workflow, { id: 'arc', isArchived: true })],
      failures: [httpError('POST /api/v1/workflows/arc/unarchive', 403)],
    });

    const report = await run([workflow, fakeLocalWorkflow('new')], n8n, fakeManaged({ crm: 'arc' }));

    expect(report.results).toEqual([
      {
        stableName: 'crm',
        path: 'workflows/crm.json',
        action: 'failed',
        id: 'arc',
        name: 'Workflow crm',
        error: {
          call: 'POST /api/v1/workflows/arc/unarchive',
          detail: 'HTTP 403',
          hint: 'Unarchive the workflow in the n8n editor, or give the API key the workflow:delete scope, then run deploy again',
        },
      },
      expect.objectContaining({ stableName: 'new', action: 'created' }),
    ]);
    expect(report.error).toBeUndefined();
    expect(report.exitCode).toBe(5);
  });

  test('Should keep delivering the others and exit 5 when one update fails', async () => {
    const n8n = fakeN8n({
      workflows: [
        fakeN8nWorkflow(fakeLocalWorkflow('a'), { id: 'ida', name: 'Old name' }),
        fakeN8nWorkflow(fakeLocalWorkflow('b'), { id: 'idb', name: 'Old name' }),
      ],
      failures: [httpError('PUT /api/v1/workflows/ida', 500, 'boom')],
    });

    const report = await run(['a', 'b', 'c'].map((name) => fakeLocalWorkflow(name)), n8n, fakeManaged({ a: 'ida', b: 'idb' }));

    expect(actions(report)).toEqual([
      ['a', 'failed'],
      ['b', 'updated'],
      ['c', 'created'],
    ]);
    expect(report.error).toBeUndefined();
    expect(report.exitCode).toBe(5);
  });

  test('Should name the failed call and its hint when an update fails', async () => {
    const n8n = fakeN8n({
      workflows: [fakeN8nWorkflow(fakeLocalWorkflow('a'), { id: 'ida', name: 'Old name' })],
      failures: [httpError('PUT /api/v1/workflows/ida', 500, 'boom')],
    });

    const report = await run([fakeLocalWorkflow('a')], n8n, fakeManaged({ a: 'ida' }));

    expect(report.results[0]).toMatchObject({
      id: 'ida',
      error: {
        call: 'PUT /api/v1/workflows/ida',
        detail: 'HTTP 500: boom',
        hint: 'Check the workflow file and the n8n instance (n8n 2.35.0 or later), then run deploy again',
      },
    });
  });

  test('Should mark the rest not-processed and exit 4 when the key is rejected mid-run', async () => {
    const n8n = fakeN8n({
      workflows: [fakeN8nWorkflow(fakeLocalWorkflow('a'), { id: 'ida', name: 'Old name' })],
      failures: [httpError('POST /api/v1/workflows', 401)],
    });

    const report = await run(['a', 'b', 'c', 'd'].map((name) => fakeLocalWorkflow(name)), n8n, fakeManaged({ a: 'ida' }));

    expect(actions(report)).toEqual([
      ['a', 'updated'],
      ['b', 'failed'],
      ['c', 'not-processed'],
      ['d', 'not-processed'],
    ]);
    expect(report.error).toMatchObject({ call: 'POST /api/v1/workflows', detail: 'HTTP 401', kind: 'key-rejected' });
    expect(report.exitCode).toBe(4);
    expect(n8n.calls.filter((call) => call === 'POST /api/v1/workflows')).toHaveLength(1);
  });

  test('Should report a not-processed workflow without an id when the run stops before it', async () => {
    const n8n = fakeN8n({ failures: [httpError('POST /api/v1/workflows', 401)] });

    const report = await run([fakeLocalWorkflow('a'), fakeLocalWorkflow('b')], n8n);

    expect(report.results[1]).toEqual({ stableName: 'b', path: 'workflows/b.json', action: 'not-processed', name: 'Workflow b' });
  });

  test('Should stop the run with exit 7 and name the created id when the lock file cannot be written', async () => {
    const n8n = fakeN8n();
    const lock = fakeLockWriter({ failWith: 'EACCES: permission denied' });

    const report = await run(['a', 'b', 'c'].map((name) => fakeLocalWorkflow(name)), n8n, fakeManaged(), lock);

    expect(report).toMatchObject({
      exitCode: 7,
      error: {
        kind: 'lock-write-failed',
        call: 'write boilerlift.lock.json',
        detail: 'workflow w1 was created for a, but boilerlift.lock.json could not be written: EACCES: permission denied',
        hint: 'Add "a": { "n8nId": "w1" } under "https://n8n.example.com" in boilerlift.lock.json by hand and commit it, then run deploy again',
      },
    });
    expect(report.results[0]).toMatchObject({ stableName: 'a', action: 'failed', id: 'w1' });
  });

  test('Should not process the remaining workflows when the lock file cannot be written after a create', async () => {
    const n8n = fakeN8n();
    const lock = fakeLockWriter({ failWith: 'EACCES: permission denied' });

    const report = await run(['a', 'b', 'c'].map((name) => fakeLocalWorkflow(name)), n8n, fakeManaged(), lock);

    expect(actions(report)).toEqual([
      ['a', 'failed'],
      ['b', 'not-processed'],
      ['c', 'not-processed'],
    ]);
    expect(n8n.calls.filter((call) => call === 'POST /api/v1/workflows')).toHaveLength(1);
  });

  test.each<[number, string, ApiFailure, string]>([
    [3, 'unreachable', unreachable('GET /api/v1/workflows/ida', 'connection refused'), PING_HINT],
    [4, 'answered 401', httpError('GET /api/v1/workflows/ida', 401), KEY_HINT],
    [4, 'answered 403', httpError('GET /api/v1/workflows/ida', 403), KEY_HINT],
  ])('Should stop before any write with exit %s when the first recorded workflow read is %s', async (exitCode, _condition, failure, hint) => {
    const n8n = fakeN8n({ failures: [failure], workflows: [fakeN8nWorkflow(fakeLocalWorkflow('a'), { id: 'ida' })] });

    const report = await run([fakeLocalWorkflow('a'), fakeLocalWorkflow('b')], n8n, fakeManaged({ a: 'ida' }));

    expect(report).toMatchObject({ exitCode, error: { call: 'GET /api/v1/workflows/ida', hint } });
    expect(n8n.calls).toEqual(['GET /api/v1/openapi.yml', 'GET /api/v1/workflows/ida']);
  });

  test('Should write nothing and mark the rest not-processed with exit 3 when a read fails mid-plan', async () => {
    const n8n = fakeN8n({
      workflows: [
        fakeN8nWorkflow(fakeLocalWorkflow('a'), { id: 'ida', name: 'Old name' }),
        fakeN8nWorkflow(fakeLocalWorkflow('b'), { id: 'idb', name: 'Old name' }),
      ],
      failures: [unreachable('GET /api/v1/workflows/idb', 'connection reset')],
    });

    const report = await run(['a', 'b', 'c'].map((name) => fakeLocalWorkflow(name)), n8n, fakeManaged({ a: 'ida', b: 'idb' }));

    expect(actions(report)).toEqual([
      ['a', 'not-processed'],
      ['b', 'failed'],
      ['c', 'not-processed'],
    ]);
    expect(report).toMatchObject({ exitCode: 3, error: { call: 'GET /api/v1/workflows/idb', kind: 'unreachable' } });
    expect(n8n.calls).toEqual(['GET /api/v1/openapi.yml', 'GET /api/v1/workflows/ida', 'GET /api/v1/workflows/idb']);
  });
});

/** Local workflows to create, recreate, update, skip and restore, the instance workflows they meet, and their record. */
function mixedSeed(): { workflows: LocalWorkflow[]; instance: N8nWorkflow[]; managed: Map<StableName, WorkflowId> } {
  const changed = fakeLocalWorkflow('changed');
  const same = fakeLocalWorkflow('same');
  const archived = fakeLocalWorkflow('archived');
  return {
    workflows: [fakeLocalWorkflow('new'), fakeLocalWorkflow('gone'), changed, same, archived],
    instance: [
      fakeN8nWorkflow(changed, { id: 'idc', name: 'Old name' }),
      fakeN8nWorkflow(same, { id: 'ids' }),
      fakeN8nWorkflow(archived, { id: 'ida', isArchived: true }),
    ],
    managed: fakeManaged({ changed: 'idc', same: 'ids', archived: 'ida', gone: 'idg' }),
  };
}

describe('planDeploy', () => {
  test('Should plan one action per workflow when the record holds new, gone, changed, unchanged and archived ones', async () => {
    const { workflows, instance, managed } = mixedSeed();
    const n8n = fakeN8n({ workflows: instance });

    const report = planToReport(await planDeploy({ workflows, client: n8n.client, managed }));

    expect(actions(report)).toEqual([
      ['archived', 'restored'],
      ['changed', 'updated'],
      ['gone', 'recreated'],
      ['new', 'created'],
      ['same', 'skipped'],
    ]);
    expect(report.exitCode).toBe(0);
  });

  test('Should make only reads, one per recorded workflow, when it plans', async () => {
    const { workflows, instance, managed } = mixedSeed();
    const n8n = fakeN8n({ workflows: instance });

    await planDeploy({ workflows, client: n8n.client, managed });

    expect(n8n.calls).toEqual([
      'GET /api/v1/openapi.yml',
      'GET /api/v1/workflows/ida',
      'GET /api/v1/workflows/idc',
      'GET /api/v1/workflows/idg',
      'GET /api/v1/workflows/ids',
    ]);
  });

  test('Should say the lock file would change when a dry run would create or recreate a workflow', async () => {
    const { workflows, instance, managed } = mixedSeed();
    const n8n = fakeN8n({ workflows: instance });

    const report = planToReport(await planDeploy({ workflows, client: n8n.client, managed }));

    expect(report.lockFile).toEqual({ path: 'boilerlift.lock.json', changed: true });
  });

  test('Should say the lock file would not change when a dry run only updates recorded workflows', async () => {
    const workflow = fakeLocalWorkflow('a');
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(workflow, { id: 'ida', name: 'Old name' })] });

    const report = planToReport(await planDeploy({ workflows: [workflow], client: n8n.client, managed: fakeManaged({ a: 'ida' }) }));

    expect(report.lockFile.changed).toBe(false);
  });

  test('Should take exactly the planned actions when deploy runs on the same instance', async () => {
    const { workflows, instance, managed } = mixedSeed();
    const planned = planToReport(await planDeploy({ workflows, client: fakeN8n({ workflows: instance }).client, managed }));

    const deployed = await run(workflows, fakeN8n({ workflows: instance }), managed);

    expect(actions(deployed)).toEqual(actions(planned));
    expect(deployed.exitCode).toBe(planned.exitCode);
  });

  test.each<[string, FakeN8nOptions, number]>([
    ['the spec has no publishIfActive', { spec: 'paths: {}\n' }, 6],
    ['the instance is unreachable', { failures: [unreachable('GET /api/v1/openapi.yml', 'refused')] }, 3],
  ])('Should stop before planning any workflow when %s', async (_condition, options, exitCode) => {
    const n8n = fakeN8n({ ...options, workflows: [fakeN8nWorkflow(fakeLocalWorkflow('a'), { id: 'abc' })] });

    const plan = await planDeploy({ workflows: [fakeLocalWorkflow('a'), fakeLocalWorkflow('b')], client: n8n.client, managed: fakeManaged({ a: 'abc' }) });

    expect(plan.steps).toEqual([]);
    expect(plan.exitCode).toBe(exitCode);
    expect(n8n.calls).toEqual(['GET /api/v1/openapi.yml']);
  });
});
