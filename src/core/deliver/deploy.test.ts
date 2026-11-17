import { describe, expect, test } from 'vitest';
import { fakeLocalWorkflow } from '#src/core/compile/workflow.fake';
import { LocalWorkflow } from '#src/core/compile/workflow.model';
import { planToReport } from '#src/core/deliver/apply-plan';
import { deploy } from '#src/core/deliver/deploy';
import { DeployReport } from '#src/core/deliver/deploy.model';
import { planDeploy } from '#src/core/deliver/plan-deploy';
import { FakeN8nOptions, fakeN8n, fakeN8nWorkflow, fakeStableTag, httpError, unreachable } from '#src/core/n8n/n8n.fake';
import { ApiFailure, N8nWorkflow } from '#src/core/n8n/n8n.model';

const PING_HINT = 'Run n8nlift ping to check N8N_URL and your network, then run deploy again';

function actions(report: DeployReport): string[][] {
  return report.results.map(({ stableName, action }) => [stableName, action]);
}

describe('deploy', () => {
  test('Should report the workflow created with its new id when no workflow carries its stable tag', async () => {
    const n8n = fakeN8n();

    const report = await deploy({ workflows: [fakeLocalWorkflow('invoice-sync')], client: n8n.client });

    expect(report).toEqual({
      warnings: [],
      exitCode: 0,
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

  test('Should tag a created workflow with its stable name when the instance has no such tag yet', async () => {
    const n8n = fakeN8n({ tags: [{ id: 'other', name: 'other' }] });

    await deploy({ workflows: [fakeLocalWorkflow('invoice-sync')], client: n8n.client });

    expect(n8n.workflows[0]?.tags).toEqual([{ id: 't2', name: 'n8nlift:invoice-sync' }]);
  });

  test('Should read the workflows, the spec and the tags before the first write when it creates a workflow', async () => {
    const n8n = fakeN8n();

    await deploy({ workflows: [fakeLocalWorkflow('invoice-sync')], client: n8n.client });

    expect(n8n.calls).toEqual([
      'GET /api/v1/workflows',
      'GET /api/v1/openapi.yml',
      'GET /api/v1/tags',
      'POST /api/v1/workflows',
      'POST /api/v1/tags',
      'PUT /api/v1/workflows/w1/tags',
    ]);
  });

  test('Should reuse the stable tag when the instance already has it', async () => {
    const n8n = fakeN8n({ tags: [{ id: 'ta', name: 'n8nlift:a' }] });

    await deploy({ workflows: [fakeLocalWorkflow('a')], client: n8n.client });

    expect(n8n.workflows[0]?.tags).toEqual([{ id: 'ta', name: 'n8nlift:a' }]);
  });

  test('Should read the tag list once when it creates several workflows', async () => {
    const n8n = fakeN8n({ tags: [{ id: 'ta', name: 'n8nlift:a' }] });

    await deploy({ workflows: [fakeLocalWorkflow('b'), fakeLocalWorkflow('a')], client: n8n.client });

    expect(n8n.calls.filter((call) => call === 'GET /api/v1/tags')).toHaveLength(1);
  });

  test('Should update a workflow when its current draft differs from the file', async () => {
    const workflow = fakeLocalWorkflow('crm-import');
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(workflow, { id: 'abc', name: 'Old name' })] });

    const report = await deploy({ workflows: [workflow], client: n8n.client });

    expect(report.results).toEqual([expect.objectContaining({ action: 'updated', id: 'abc' })]);
    expect(n8n.workflows[0]?.name).toBe('Workflow crm-import');
  });

  test('Should leave the tags alone when it updates a workflow', async () => {
    const workflow = fakeLocalWorkflow('crm-import');
    const tags = [fakeStableTag('crm-import'), { id: 'hand', name: 'hand-added' }];
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(workflow, { id: 'abc', name: 'Old name', tags })] });

    await deploy({ workflows: [workflow], client: n8n.client });

    expect(n8n.calls).toEqual([
      'GET /api/v1/workflows',
      'GET /api/v1/openapi.yml',
      'GET /api/v1/workflows/abc',
      'PUT /api/v1/workflows/abc',
    ]);
    expect(n8n.workflows[0]?.tags).toEqual(tags);
  });

  test('Should skip a workflow and write nothing when its draft matches the file but for node ids and server settings', async () => {
    const workflow = fakeLocalWorkflow('daily-report');
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(workflow, { id: 'abc' })] });

    const report = await deploy({ workflows: [workflow], client: n8n.client });

    expect(report.results).toEqual([expect.objectContaining({ action: 'skipped', id: 'abc' })]);
    expect(n8n.calls).toEqual(['GET /api/v1/workflows', 'GET /api/v1/openapi.yml', 'GET /api/v1/workflows/abc']);
  });

  test('Should skip every workflow and write nothing when it deploys the same files twice', async () => {
    const n8n = fakeN8n();
    const workflows = [fakeLocalWorkflow('a'), fakeLocalWorkflow('b')];
    await deploy({ workflows, client: n8n.client });
    n8n.calls.length = 0;

    const report = await deploy({ workflows, client: n8n.client });

    expect(actions(report)).toEqual([
      ['a', 'skipped'],
      ['b', 'skipped'],
    ]);
    expect(n8n.calls).toEqual([
      'GET /api/v1/workflows',
      'GET /api/v1/openapi.yml',
      'GET /api/v1/workflows/w1',
      'GET /api/v1/workflows/w3',
    ]);
  });

  test('Should fail only that workflow and exit 5 when two live workflows carry its stable tag', async () => {
    const workflow = fakeLocalWorkflow('dup');
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(workflow, { id: 'a' }), fakeN8nWorkflow(workflow, { id: 'b' })] });

    const report = await deploy({ workflows: [workflow, fakeLocalWorkflow('new')], client: n8n.client });

    expect(report.results).toEqual([
      {
        stableName: 'dup',
        path: 'workflows/dup.json',
        action: 'failed',
        name: 'Workflow dup',
        error: {
          call: 'GET /api/v1/workflows',
          detail: 'workflows a and b both carry the tag n8nlift:dup',
          hint: 'Remove the tag n8nlift:dup from one of them in the n8n editor, then run deploy again',
        },
      },
      expect.objectContaining({ stableName: 'new', action: 'created' }),
    ]);
    expect(report.error).toBeUndefined();
    expect(report.exitCode).toBe(5);
  });

  test('Should read neither copy when two live workflows carry the stable tag', async () => {
    const workflow = fakeLocalWorkflow('dup');
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(workflow, { id: 'a' }), fakeN8nWorkflow(workflow, { id: 'b' })] });

    await deploy({ workflows: [workflow], client: n8n.client });

    expect(n8n.calls).toEqual(['GET /api/v1/workflows', 'GET /api/v1/openapi.yml']);
  });

  test('Should stop before any write with exit 6 when the spec has no publishIfActive', async () => {
    const workflow = fakeLocalWorkflow('a');
    const n8n = fakeN8n({ spec: 'paths:\n  /workflows/{id}:\n    put: {}\n', workflows: [fakeN8nWorkflow(workflow, { id: 'abc' })] });

    const report = await deploy({ workflows: [workflow, fakeLocalWorkflow('b')], client: n8n.client });

    expect(report).toEqual({
      results: [],
      warnings: [],
      error: {
        call: 'GET /api/v1/openapi.yml',
        detail: 'the API spec has no publishIfActive: n8n 2.35.0 or later is required',
        hint: 'Upgrade the instance to n8n 2.35.0 or later, then run deploy again',
        kind: 'drafts-unsupported',
      },
      exitCode: 6,
    });
    expect(n8n.calls).toEqual(['GET /api/v1/workflows', 'GET /api/v1/openapi.yml']);
  });

  test.each([[404], [500]])('Should stop before any write with exit 6 when the spec answers HTTP %s', async (status) => {
    const n8n = fakeN8n({ failures: [httpError('GET /api/v1/openapi.yml', status)] });

    const report = await deploy({ workflows: [fakeLocalWorkflow('a')], client: n8n.client });

    expect(report).toMatchObject({ results: [], exitCode: 6, error: { detail: `HTTP ${status}: n8n 2.35.0 or later is required` } });
    expect(n8n.calls).toEqual(['GET /api/v1/workflows', 'GET /api/v1/openapi.yml']);
  });

  test('Should stop before any write with exit 3 and the ping hint when the spec cannot be reached', async () => {
    const n8n = fakeN8n({ failures: [unreachable('GET /api/v1/openapi.yml', 'connection reset')] });

    const report = await deploy({ workflows: [fakeLocalWorkflow('a')], client: n8n.client });

    expect(report).toMatchObject({ results: [], exitCode: 3, error: { hint: PING_HINT } });
    expect(n8n.calls).toEqual(['GET /api/v1/workflows', 'GET /api/v1/openapi.yml']);
  });

  test('Should report the workflow restored when only an archived workflow carries its stable tag', async () => {
    const workflow = fakeLocalWorkflow('crm');
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(workflow, { id: 'arc', name: 'Old name', isArchived: true })] });

    const report = await deploy({ workflows: [workflow], client: n8n.client });

    expect(report.results).toEqual([expect.objectContaining({ stableName: 'crm', action: 'restored', id: 'arc' })]);
    expect(report.exitCode).toBe(0);
  });

  test('Should warn that the workflow is back as an unpublished draft when it restores it', async () => {
    const workflow = fakeLocalWorkflow('crm');
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(workflow, { id: 'arc', isArchived: true })] });

    const report = await deploy({ workflows: [workflow], client: n8n.client });

    expect(report.warnings).toEqual([{ kind: 'restored', stableName: 'crm', id: 'arc' }]);
  });

  test('Should unarchive, then update as a draft when the archived workflow differs from the file', async () => {
    const workflow = fakeLocalWorkflow('crm');
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(workflow, { id: 'arc', name: 'Old name', isArchived: true })] });

    await deploy({ workflows: [workflow], client: n8n.client });

    expect(n8n.calls).toEqual([
      'GET /api/v1/workflows',
      'GET /api/v1/openapi.yml',
      'POST /api/v1/workflows/arc/unarchive',
      'GET /api/v1/workflows/arc',
      'PUT /api/v1/workflows/arc',
    ]);
    expect(n8n.workflows[0]).toMatchObject({ isArchived: false, name: 'Workflow crm', tags: [fakeStableTag('crm')] });
  });

  test('Should restore without an update when the archived workflow already matches the file', async () => {
    const workflow = fakeLocalWorkflow('crm');
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(workflow, { id: 'arc', isArchived: true })] });

    const report = await deploy({ workflows: [workflow], client: n8n.client });

    expect(report.results).toEqual([expect.objectContaining({ action: 'restored', id: 'arc' })]);
    expect(n8n.calls).not.toContain('PUT /api/v1/workflows/arc');
  });

  test('Should restore the first archived copy when several archived workflows carry the stable tag', async () => {
    const workflow = fakeLocalWorkflow('crm');
    const n8n = fakeN8n({
      workflows: [fakeN8nWorkflow(workflow, { id: 'arc1', isArchived: true }), fakeN8nWorkflow(workflow, { id: 'arc2', isArchived: true })],
    });

    const report = await deploy({ workflows: [workflow], client: n8n.client });

    expect(report.results).toEqual([expect.objectContaining({ action: 'restored', id: 'arc1' })]);
  });

  test('Should name the restored copy in a warning when several archived workflows carry the stable tag', async () => {
    const workflow = fakeLocalWorkflow('crm');
    const n8n = fakeN8n({
      workflows: [fakeN8nWorkflow(workflow, { id: 'arc1', isArchived: true }), fakeN8nWorkflow(workflow, { id: 'arc2', isArchived: true })],
    });

    const report = await deploy({ workflows: [workflow], client: n8n.client });

    expect(report.warnings).toContainEqual({ kind: 'several-archived', stableName: 'crm', archivedIds: ['arc1', 'arc2'], restoredId: 'arc1' });
  });

  test('Should fail only that workflow with the scope hint when the instance refuses to unarchive it', async () => {
    const workflow = fakeLocalWorkflow('crm');
    const n8n = fakeN8n({
      workflows: [fakeN8nWorkflow(workflow, { id: 'arc', isArchived: true })],
      failures: [httpError('POST /api/v1/workflows/arc/unarchive', 403)],
    });

    const report = await deploy({ workflows: [workflow, fakeLocalWorkflow('new')], client: n8n.client });

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

  test('Should deliver to the live workflow when an archived copy also carries the stable tag', async () => {
    const workflow = fakeLocalWorkflow('crm');
    const n8n = fakeN8n({
      workflows: [fakeN8nWorkflow(workflow, { id: 'arc', isArchived: true }), fakeN8nWorkflow(workflow, { id: 'live' })],
    });

    const report = await deploy({ workflows: [workflow], client: n8n.client });

    expect(report.results).toEqual([expect.objectContaining({ action: 'skipped', id: 'live' })]);
    expect(n8n.calls).not.toContain('POST /api/v1/workflows/arc/unarchive');
  });

  test('Should warn about the archived copy when it carries the stable tag next to a live workflow', async () => {
    const workflow = fakeLocalWorkflow('crm');
    const n8n = fakeN8n({
      workflows: [fakeN8nWorkflow(workflow, { id: 'arc', isArchived: true }), fakeN8nWorkflow(workflow, { id: 'live' })],
    });

    const report = await deploy({ workflows: [workflow], client: n8n.client });

    expect(report.warnings).toEqual([{ kind: 'archived-copies', stableName: 'crm', archivedIds: ['arc'], liveId: 'live' }]);
  });

  test('Should keep delivering the others and exit 5 when one update fails', async () => {
    const n8n = fakeN8n({
      workflows: [
        fakeN8nWorkflow(fakeLocalWorkflow('a'), { id: 'ida', name: 'Old name' }),
        fakeN8nWorkflow(fakeLocalWorkflow('b'), { id: 'idb', name: 'Old name' }),
      ],
      failures: [httpError('PUT /api/v1/workflows/ida', 500, 'boom')],
    });

    const report = await deploy({ workflows: ['a', 'b', 'c'].map((name) => fakeLocalWorkflow(name)), client: n8n.client });

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

    const report = await deploy({ workflows: [fakeLocalWorkflow('a')], client: n8n.client });

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

    const report = await deploy({ workflows: ['a', 'b', 'c', 'd'].map((name) => fakeLocalWorkflow(name)), client: n8n.client });

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

    const report = await deploy({ workflows: [fakeLocalWorkflow('a'), fakeLocalWorkflow('b')], client: n8n.client });

    expect(report.results[1]).toEqual({ stableName: 'b', path: 'workflows/b.json', action: 'not-processed', name: 'Workflow b' });
  });

  test.each<[number, string, ApiFailure, string]>([
    [3, 'unreachable', unreachable('GET /api/v1/workflows', 'connection refused'), PING_HINT],
    [4, 'answered 401', httpError('GET /api/v1/workflows', 401), 'Create a key in n8n → Settings → n8n API, then set N8N_API_KEY in .env'],
    [4, 'answered 403', httpError('GET /api/v1/workflows', 403), 'Create a key in n8n → Settings → n8n API, then set N8N_API_KEY in .env'],
  ])('Should stop before any other call with exit %s when the workflow list is %s', async (exitCode, _condition, failure, hint) => {
    const n8n = fakeN8n({ failures: [failure] });

    const report = await deploy({ workflows: [fakeLocalWorkflow('a')], client: n8n.client });

    expect(report).toMatchObject({ results: [], exitCode, error: { call: 'GET /api/v1/workflows', hint } });
    expect(n8n.calls).toEqual(['GET /api/v1/workflows']);
  });

  test('Should write nothing and mark the rest not-processed with exit 3 when a read fails mid-plan', async () => {
    const n8n = fakeN8n({
      workflows: [
        fakeN8nWorkflow(fakeLocalWorkflow('a'), { id: 'ida', name: 'Old name' }),
        fakeN8nWorkflow(fakeLocalWorkflow('b'), { id: 'idb', name: 'Old name' }),
      ],
      failures: [unreachable('GET /api/v1/workflows/idb', 'connection reset')],
    });

    const report = await deploy({ workflows: ['a', 'b', 'c'].map((name) => fakeLocalWorkflow(name)), client: n8n.client });

    expect(actions(report)).toEqual([
      ['a', 'not-processed'],
      ['b', 'failed'],
      ['c', 'not-processed'],
    ]);
    expect(report).toMatchObject({ exitCode: 3, error: { call: 'GET /api/v1/workflows/idb', kind: 'unreachable' } });
    expect(n8n.calls).toEqual([
      'GET /api/v1/workflows',
      'GET /api/v1/openapi.yml',
      'GET /api/v1/workflows/ida',
      'GET /api/v1/workflows/idb',
    ]);
  });
});

/** Local workflows to create, update, skip, restore and fail as a duplicate, and the instance workflows they meet. */
function mixedSeed(): { workflows: LocalWorkflow[]; instance: N8nWorkflow[] } {
  const changed = fakeLocalWorkflow('changed');
  const same = fakeLocalWorkflow('same');
  const archived = fakeLocalWorkflow('archived');
  const dup = fakeLocalWorkflow('dup');
  return {
    workflows: [fakeLocalWorkflow('new'), changed, same, archived, dup],
    instance: [
      fakeN8nWorkflow(changed, { id: 'idc', name: 'Old name' }),
      fakeN8nWorkflow(same, { id: 'ids' }),
      fakeN8nWorkflow(archived, { id: 'ida', isArchived: true }),
      fakeN8nWorkflow(dup, { id: 'd1' }),
      fakeN8nWorkflow(dup, { id: 'd2' }),
    ],
  };
}

describe('planDeploy', () => {
  test('Should plan one action per workflow when the instance holds new, changed, unchanged, archived and duplicate ones', async () => {
    const { workflows, instance } = mixedSeed();
    const n8n = fakeN8n({ workflows: instance });

    const report = planToReport(await planDeploy({ workflows, client: n8n.client }));

    expect(actions(report)).toEqual([
      ['archived', 'restored'],
      ['changed', 'updated'],
      ['dup', 'failed'],
      ['new', 'created'],
      ['same', 'skipped'],
    ]);
    expect(report.exitCode).toBe(5);
  });

  test('Should make only reads when it plans', async () => {
    const { workflows, instance } = mixedSeed();
    const n8n = fakeN8n({ workflows: instance });

    await planDeploy({ workflows, client: n8n.client });

    expect(n8n.calls).toEqual([
      'GET /api/v1/workflows',
      'GET /api/v1/openapi.yml',
      'GET /api/v1/workflows/idc',
      'GET /api/v1/workflows/ids',
      'GET /api/v1/tags',
    ]);
  });

  test('Should take exactly the planned actions when deploy runs on the same instance', async () => {
    const { workflows, instance } = mixedSeed();
    const planned = planToReport(await planDeploy({ workflows, client: fakeN8n({ workflows: instance }).client }));

    const deployed = await deploy({ workflows, client: fakeN8n({ workflows: instance }).client });

    expect(actions(deployed)).toEqual(actions(planned));
    expect(deployed.exitCode).toBe(planned.exitCode);
  });

  test.each<[string, FakeN8nOptions, number]>([
    ['the spec has no publishIfActive', { spec: 'paths: {}\n' }, 6],
    ['the instance is unreachable', { failures: [unreachable('GET /api/v1/workflows', 'refused')] }, 3],
    ['the key is rejected', { failures: [httpError('GET /api/v1/workflows', 401)] }, 4],
  ])('Should stop before planning any workflow when %s', async (_condition, options, exitCode) => {
    const n8n = fakeN8n({ ...options, workflows: [fakeN8nWorkflow(fakeLocalWorkflow('a'), { id: 'abc' })] });

    const plan = await planDeploy({ workflows: [fakeLocalWorkflow('a'), fakeLocalWorkflow('b')], client: n8n.client });

    expect(plan.steps).toEqual([]);
    expect(plan.exitCode).toBe(exitCode);
    expect(n8n.calls).not.toContain('GET /api/v1/workflows/abc');
    expect(n8n.calls).not.toContain('GET /api/v1/tags');
  });

  test('Should plan the restore warnings when several archived workflows carry the stable tag', async () => {
    const workflow = fakeLocalWorkflow('crm');
    const n8n = fakeN8n({
      workflows: [fakeN8nWorkflow(workflow, { id: 'arc1', isArchived: true }), fakeN8nWorkflow(workflow, { id: 'arc2', isArchived: true })],
    });

    const plan = await planDeploy({ workflows: [workflow], client: n8n.client });

    expect(plan.warnings).toEqual([
      { kind: 'restored', stableName: 'crm', id: 'arc1' },
      { kind: 'several-archived', stableName: 'crm', archivedIds: ['arc1', 'arc2'], restoredId: 'arc1' },
    ]);
  });
});
