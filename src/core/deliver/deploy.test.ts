import { describe, expect, test } from 'vitest';
import { LocalWorkflow } from '#src/core/compile/workflow.model';
import { deploy, planDeploy, planToReport } from '#src/core/deliver/deploy';
import { ApiFailure, ApiResult, N8nClient, N8nTag, N8nWorkflow } from '#src/core/n8n/n8n.model';

type Method = Exclude<keyof N8nClient, 'checkHealth' | 'checkApiKey'>;

interface FakeInstance {
  client: N8nClient;
  workflows: N8nWorkflow[];
  tags: N8nTag[];
  calls: string[];
}

const DRAFT_SPEC = 'paths:\n  /workflows/{id}:\n    put:\n      parameters:\n        - name: publishIfActive\n';

/**
 * An in-memory n8n instance behind the `N8nClient` interface. `failures` makes a call fail, keyed by the method
 * name (every call of it) or by the recorded call string (that one call, for example `update abc`).
 */
function fakeInstance(
  seed: { workflows?: N8nWorkflow[]; tags?: N8nTag[]; spec?: string } = {},
  failures: Partial<Record<Method | (string & {}), ApiFailure>> = {},
): FakeInstance {
  const workflows = structuredClone(seed.workflows ?? []);
  const tags = structuredClone(seed.tags ?? []);
  const calls: string[] = [];
  let nextId = 1;
  const answer = <T>(method: Method, call: string, body: () => T): Promise<ApiResult<T>> => {
    calls.push(call);
    const failure = failures[call] ?? failures[method];
    return Promise.resolve(failure ?? { kind: 'ok', status: 200, body: body() });
  };
  const find = (id: string): N8nWorkflow => {
    const workflow = workflows.find((candidate) => candidate.id === id);
    if (workflow === undefined) throw new Error(`no workflow ${id}`);
    return workflow;
  };
  const client: N8nClient = {
    checkHealth: () => Promise.reject(new Error('not used')),
    checkApiKey: () => Promise.reject(new Error('not used')),
    readApiSpec: () => answer('readApiSpec', 'spec', () => seed.spec ?? DRAFT_SPEC),
    listWorkflows: () =>
      answer('listWorkflows', 'list', () =>
        workflows.map(({ id, name, tags: t, isArchived }) => ({ id, name, tags: t, isArchived })),
      ),
    getWorkflow: (id) => answer('getWorkflow', `get ${id}`, () => structuredClone(find(id))),
    createWorkflow: (body) =>
      answer('createWorkflow', `create ${body.name}`, () => {
        const workflow = { id: `w${nextId++}`, tags: [], isArchived: false, ...structuredClone(body) };
        workflows.push(workflow);
        return structuredClone(workflow);
      }),
    updateWorkflow: (id, body) =>
      answer('updateWorkflow', `update ${id}`, () => Object.assign(find(id), structuredClone(body))),
    unarchiveWorkflow: (id) =>
      answer('unarchiveWorkflow', `unarchive ${id}`, () => Object.assign(find(id), { isArchived: false })),
    listTags: () => answer('listTags', 'listTags', () => structuredClone(tags)),
    createTag: (name) =>
      answer('createTag', `createTag ${name}`, () => {
        const tag = { id: `t${nextId++}`, name };
        tags.push(tag);
        return tag;
      }),
    setWorkflowTags: (id, tagIds) =>
      answer('setWorkflowTags', `setTags ${id} ${tagIds.join(',')}`, () => {
        const workflow = find(id);
        workflow.tags = tagIds.map((tagId) => tags.find((tag) => tag.id === tagId) ?? { id: tagId, name: '?' });
        return workflow.tags;
      }),
  };
  return { client, workflows, tags, calls };
}

const NODE = {
  id: 'local-id',
  name: 'Start',
  type: 'n8n-nodes-base.manualTrigger',
  typeVersion: 1,
  position: [0, 0],
  parameters: {},
};

function local(stableName: string, overrides: Partial<LocalWorkflow> = {}): LocalWorkflow {
  return {
    stableName,
    path: `workflows/${stableName}.json`,
    name: `Workflow ${stableName}`,
    nodes: [NODE],
    connections: {},
    settings: { executionOrder: 'v1' },
    ...overrides,
  };
}

function remoteOf(workflow: LocalWorkflow, id: string, tags: N8nTag[]): N8nWorkflow {
  return {
    id,
    name: workflow.name,
    nodes: [{ ...NODE, id: 'server-id' }],
    connections: workflow.connections,
    settings: { ...workflow.settings, redactionPolicy: 'none' },
    tags,
    isArchived: false,
  };
}

describe('deploy', () => {
  test('Should create a new workflow and tag it with its stable name', async () => {
    // Given
    const instance = fakeInstance({ tags: [{ id: 'tx', name: 'other' }] });

    // When
    const report = await deploy({ workflows: [local('invoice-sync')], client: instance.client });

    // Then
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
    expect(instance.calls).toEqual([
      'list',
      'spec',
      'listTags',
      'create Workflow invoice-sync',
      'createTag n8nlift:invoice-sync',
      'setTags w1 t2',
    ]);
    expect(instance.workflows[0]?.tags).toEqual([{ id: 't2', name: 'n8nlift:invoice-sync' }]);
  });

  test('Should reuse an existing stable tag and read the tag list once', async () => {
    // Given
    const instance = fakeInstance({ tags: [{ id: 'ta', name: 'n8nlift:a' }] });

    // When
    await deploy({ workflows: [local('b'), local('a')], client: instance.client });

    // Then
    expect(instance.calls.filter((call) => call === 'listTags')).toHaveLength(1);
    expect(instance.calls).toContain('setTags w1 ta');
    expect(instance.calls).toContain('createTag n8nlift:b');
  });

  test('Should update a changed workflow without touching its tags', async () => {
    // Given
    const workflow = local('crm-import');
    const tags = [
      { id: 't1', name: 'n8nlift:crm-import' },
      { id: 't2', name: 'hand-added' },
    ];
    const instance = fakeInstance({ workflows: [{ ...remoteOf(workflow, 'abc', tags), name: 'Old name' }] });

    // When
    const report = await deploy({ workflows: [workflow], client: instance.client });

    // Then
    expect(report.results).toEqual([expect.objectContaining({ action: 'updated', id: 'abc' })]);
    expect(instance.calls).toEqual(['list', 'spec', 'get abc', 'update abc']);
    expect(instance.workflows[0]).toMatchObject({ name: 'Workflow crm-import', tags });
  });

  test('Should skip a workflow whose current draft matches, ignoring node ids and server settings', async () => {
    // Given
    const workflow = local('daily-report');
    const instance = fakeInstance({
      workflows: [remoteOf(workflow, 'abc', [{ id: 't1', name: 'n8nlift:daily-report' }])],
    });

    // When
    const report = await deploy({ workflows: [workflow], client: instance.client });

    // Then
    expect(report.results).toEqual([expect.objectContaining({ action: 'skipped', id: 'abc' })]);
    expect(instance.calls).toEqual(['list', 'spec', 'get abc']);
  });

  test('Should write nothing on a second run', async () => {
    // Given
    const instance = fakeInstance();
    const workflows = [local('a'), local('b')];
    await deploy({ workflows, client: instance.client });
    instance.calls.length = 0;

    // When
    const report = await deploy({ workflows, client: instance.client });

    // Then
    expect(report.results.map(({ action }) => action)).toEqual(['skipped', 'skipped']);
    expect(instance.calls).toEqual(['list', 'spec', 'get w1', 'get w3']);
  });

  test('Should fail only the workflow whose stable tag is on two live workflows', async () => {
    // Given
    const tag = { id: 't1', name: 'n8nlift:dup' };
    const workflow = local('dup');
    const instance = fakeInstance({ workflows: [remoteOf(workflow, 'a', [tag]), remoteOf(workflow, 'b', [tag])] });

    // When
    const report = await deploy({ workflows: [workflow, local('new')], client: instance.client });

    // Then
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
    expect(instance.calls).not.toContain('get a');
    expect(instance.calls).not.toContain('get b');
  });

  test('Should write nothing and exit 6 when the spec has no publishIfActive', async () => {
    // Given
    const spec = 'paths:\n  /workflows/{id}:\n    put: {}\n';
    const instance = fakeInstance({ spec, workflows: [remoteOf(local('a'), 'abc', [{ id: 't1', name: 'n8nlift:a' }])] });

    // When
    const report = await deploy({ workflows: [local('a'), local('b')], client: instance.client });

    // Then
    expect(report).toEqual({
      results: [],
      warnings: [],
      error: {
        call: 'GET /api/v1/openapi.yml',
        detail: 'the API spec has no publishIfActive: n8n 2.35.0 or later is required',
        hint: 'Upgrade the instance to n8n 2.35.0 or later, then run deploy again',
        exitCode: 6,
      },
      exitCode: 6,
    });
    expect(instance.calls).toEqual(['list', 'spec']);
  });

  test.each([[404], [500]])('Should write nothing and exit 6 when the spec answers HTTP %s', async (status) => {
    // Given
    const instance = fakeInstance({}, { readApiSpec: { kind: 'http-error', call: 'GET /api/v1/openapi.yml', status } });

    // When
    const report = await deploy({ workflows: [local('a')], client: instance.client });

    // Then
    expect(report.exitCode).toBe(6);
    expect(report.results).toEqual([]);
    expect(report.error?.detail).toBe(`HTTP ${status}: n8n 2.35.0 or later is required`);
    expect(instance.calls).toEqual(['list', 'spec']);
  });

  test('Should give the ping hint and exit 3 when the spec cannot be reached', async () => {
    // Given
    const instance = fakeInstance(
      {},
      { readApiSpec: { kind: 'unreachable', call: 'GET /api/v1/openapi.yml', reason: 'connection reset' } },
    );

    // When
    const report = await deploy({ workflows: [local('a')], client: instance.client });

    // Then
    expect(report.exitCode).toBe(3);
    expect(report.error?.hint).toContain('n8nlift ping');
    expect(instance.calls).toEqual(['list', 'spec']);
  });

  test('Should unarchive a tagged archived workflow, update it as a draft and report it restored', async () => {
    // Given
    const workflow = local('crm');
    const tags = [{ id: 't1', name: 'n8nlift:crm' }];
    const instance = fakeInstance({
      workflows: [{ ...remoteOf(workflow, 'arc', tags), name: 'Old name', isArchived: true }],
    });

    // When
    const report = await deploy({ workflows: [workflow], client: instance.client });

    // Then
    expect(report.results).toEqual([expect.objectContaining({ stableName: 'crm', action: 'restored', id: 'arc' })]);
    expect(report.warnings).toEqual(['crm: workflow arc was archived in n8n; it is back as an unpublished draft']);
    expect(report.exitCode).toBe(0);
    expect(instance.calls).toEqual(['list', 'spec', 'unarchive arc', 'get arc', 'update arc']);
    expect(instance.workflows[0]).toMatchObject({ isArchived: false, name: 'Workflow crm', tags });
  });

  test('Should report restored without an update when the archived workflow already matches', async () => {
    // Given
    const workflow = local('crm');
    const instance = fakeInstance({
      workflows: [{ ...remoteOf(workflow, 'arc', [{ id: 't1', name: 'n8nlift:crm' }]), isArchived: true }],
    });

    // When
    const report = await deploy({ workflows: [workflow], client: instance.client });

    // Then
    expect(report.results).toEqual([expect.objectContaining({ action: 'restored', id: 'arc' })]);
    expect(instance.calls).toEqual(['list', 'spec', 'unarchive arc', 'get arc']);
  });

  test('Should restore the first archived copy and warn when several carry the tag', async () => {
    // Given
    const workflow = local('crm');
    const tags = [{ id: 't1', name: 'n8nlift:crm' }];
    const instance = fakeInstance({
      workflows: [
        { ...remoteOf(workflow, 'arc1', tags), isArchived: true },
        { ...remoteOf(workflow, 'arc2', tags), isArchived: true },
      ],
    });

    // When
    const report = await deploy({ workflows: [workflow], client: instance.client });

    // Then
    expect(report.results).toEqual([expect.objectContaining({ action: 'restored', id: 'arc1' })]);
    expect(report.warnings).toContain('crm: archived workflows arc1 and arc2 all carry the tag n8nlift:crm; deploy restored arc1');
  });

  test('Should fail only the restored workflow with a scope hint when unarchiving is refused', async () => {
    // Given
    const workflow = local('crm');
    const instance = fakeInstance(
      { workflows: [{ ...remoteOf(workflow, 'arc', [{ id: 't1', name: 'n8nlift:crm' }]), isArchived: true }] },
      { unarchiveWorkflow: { kind: 'http-error', call: 'POST /api/v1/workflows/arc/unarchive', status: 403 } },
    );

    // When
    const report = await deploy({ workflows: [workflow, local('new')], client: instance.client });

    // Then
    expect(report.results[0]).toEqual({
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
    });
    expect(report.results[1]).toMatchObject({ stableName: 'new', action: 'created' });
    expect(report.error).toBeUndefined();
    expect(report.exitCode).toBe(5);
  });

  test('Should use the live workflow and warn when an archived copy still carries the tag', async () => {
    // Given
    const workflow = local('crm');
    const tags = [{ id: 't1', name: 'n8nlift:crm' }];
    const instance = fakeInstance({
      workflows: [{ ...remoteOf(workflow, 'arc', tags), isArchived: true }, remoteOf(workflow, 'live', tags)],
    });

    // When
    const report = await deploy({ workflows: [workflow], client: instance.client });

    // Then
    expect(report.results).toEqual([expect.objectContaining({ action: 'skipped', id: 'live' })]);
    expect(report.warnings).toEqual([
      'crm: archived workflow arc still carries the tag n8nlift:crm; deploy used the live workflow live',
    ]);
    expect(instance.calls).not.toContain('unarchive arc');
  });

  test('Should keep delivering the others when one update fails, then exit 5', async () => {
    // Given
    const changed = (stableName: string, id: string): N8nWorkflow => ({
      ...remoteOf(local(stableName), id, [{ id: `t-${stableName}`, name: `n8nlift:${stableName}` }]),
      name: 'Old name',
    });
    const instance = fakeInstance(
      { workflows: [changed('a', 'ida'), changed('b', 'idb')] },
      { 'update ida': { kind: 'http-error', call: 'PUT /api/v1/workflows/ida', status: 500, message: 'boom' } },
    );

    // When
    const report = await deploy({ workflows: [local('a'), local('b'), local('c')], client: instance.client });

    // Then
    expect(report.results.map(({ stableName, action }) => [stableName, action])).toEqual([
      ['a', 'failed'],
      ['b', 'updated'],
      ['c', 'created'],
    ]);
    expect(report.results[0]).toMatchObject({
      id: 'ida',
      error: {
        call: 'PUT /api/v1/workflows/ida',
        detail: 'HTTP 500: boom',
        hint: 'Check the workflow file and the n8n instance (n8n 2.35.0 or later), then run deploy again',
      },
    });
    expect(report.error).toBeUndefined();
    expect(report.exitCode).toBe(5);
  });

  test('Should mark the rest not-processed and exit 4 when the key is rejected mid-run', async () => {
    // Given
    const instance = fakeInstance(
      {},
      { 'create Workflow b': { kind: 'http-error', call: 'POST /api/v1/workflows', status: 401 } },
    );

    // When
    const report = await deploy({ workflows: [local('a'), local('b'), local('c'), local('d')], client: instance.client });

    // Then
    expect(report.results.map(({ stableName, action }) => [stableName, action])).toEqual([
      ['a', 'created'],
      ['b', 'failed'],
      ['c', 'not-processed'],
      ['d', 'not-processed'],
    ]);
    expect(report.results[2]).toEqual({
      stableName: 'c',
      path: 'workflows/c.json',
      action: 'not-processed',
      name: 'Workflow c',
    });
    expect(report.error).toMatchObject({ call: 'POST /api/v1/workflows', detail: 'HTTP 401', exitCode: 4 });
    expect(report.exitCode).toBe(4);
    expect(instance.calls).not.toContain('create Workflow c');
  });

  test.each<[ApiFailure, number, string]>([
    [{ kind: 'unreachable', call: 'GET /api/v1/workflows', reason: 'connection refused' }, 3, 'n8nlift ping'],
    [{ kind: 'http-error', call: 'GET /api/v1/workflows', status: 401 }, 4, 'N8N_API_KEY'],
    [{ kind: 'http-error', call: 'GET /api/v1/workflows', status: 403 }, 4, 'N8N_API_KEY'],
  ])('Should write nothing when the list fails (%o) and exit %s', async (failure, exitCode, hint) => {
    // Given
    const instance = fakeInstance({}, { listWorkflows: failure });

    // When
    const report = await deploy({ workflows: [local('a')], client: instance.client });

    // Then
    expect(report.results).toEqual([]);
    expect(report.exitCode).toBe(exitCode);
    expect(report.error).toMatchObject({ call: 'GET /api/v1/workflows', exitCode });
    expect(report.error?.hint).toContain(hint);
    expect(instance.calls).toEqual(['list']);
  });

  test('Should mark the rest not-processed and write nothing when a GET becomes unreachable mid-plan', async () => {
    // Given
    const changed = (stableName: string, id: string): N8nWorkflow => ({
      ...remoteOf(local(stableName), id, [{ id: `t-${stableName}`, name: `n8nlift:${stableName}` }]),
      name: 'Old name',
    });
    const instance = fakeInstance(
      { workflows: [changed('a', 'ida'), changed('b', 'idb')] },
      { 'get idb': { kind: 'unreachable', call: 'GET /api/v1/workflows/idb', reason: 'connection reset' } },
    );

    // When
    const report = await deploy({ workflows: [local('a'), local('b'), local('c')], client: instance.client });

    // Then
    expect(report.results.map(({ stableName, action }) => [stableName, action])).toEqual([
      ['a', 'not-processed'],
      ['b', 'failed'],
      ['c', 'not-processed'],
    ]);
    expect(report.exitCode).toBe(3);
    expect(report.error).toMatchObject({ call: 'GET /api/v1/workflows/idb', exitCode: 3 });
    expect(instance.calls).toEqual(['list', 'spec', 'get ida', 'get idb']);
  });
});

/** A seed with one workflow to create, one to update, one to skip, one to restore and one duplicate. */
function mixedSeed(): { workflows: LocalWorkflow[]; remote: N8nWorkflow[] } {
  const tag = (stableName: string): N8nTag[] => [{ id: `t-${stableName}`, name: `n8nlift:${stableName}` }];
  const same = local('same');
  const changed = local('changed');
  const archived = local('archived');
  const dup = local('dup');
  return {
    workflows: [local('new'), changed, same, archived, dup],
    remote: [
      { ...remoteOf(changed, 'idc', tag('changed')), name: 'Old name' },
      remoteOf(same, 'ids', tag('same')),
      { ...remoteOf(archived, 'ida', tag('archived')), isArchived: true },
      remoteOf(dup, 'd1', tag('dup')),
      remoteOf(dup, 'd2', tag('dup')),
    ],
  };
}

describe('planDeploy', () => {
  test('Should make no write call during a dry run', async () => {
    // Given
    const { workflows, remote } = mixedSeed();
    const instance = fakeInstance({ workflows: remote });

    // When
    const report = planToReport(await planDeploy({ workflows, client: instance.client }));

    // Then
    expect(report.results.map(({ stableName, action }) => [stableName, action])).toEqual([
      ['archived', 'restored'],
      ['changed', 'updated'],
      ['dup', 'failed'],
      ['new', 'created'],
      ['same', 'skipped'],
    ]);
    expect(report.exitCode).toBe(5);
    expect(instance.calls).toEqual(['list', 'spec', 'get idc', 'get ids', 'listTags']);
  });

  test('Should apply exactly the planned actions', async () => {
    // Given
    const { workflows, remote } = mixedSeed();
    const planned = planToReport(await planDeploy({ workflows, client: fakeInstance({ workflows: remote }).client }));

    // When
    const deployed = await deploy({ workflows, client: fakeInstance({ workflows: remote }).client });

    // Then
    const actions = (report: typeof planned): string[][] => report.results.map(({ stableName, action }) => [stableName, action]);
    expect(actions(deployed)).toEqual(actions(planned));
    expect(deployed.exitCode).toBe(planned.exitCode);
  });

  test.each<[string, { spec?: string }, Partial<Record<string, ApiFailure>>, number]>([
    ['the spec has no publishIfActive', { spec: 'paths: {}\n' }, {}, 6],
    ['the instance is unreachable', {}, { listWorkflows: { kind: 'unreachable', call: 'GET /api/v1/workflows', reason: 'refused' } }, 3],
    ['the key is rejected', {}, { listWorkflows: { kind: 'http-error', call: 'GET /api/v1/workflows', status: 401 } }, 4],
  ])('Should stop before planning any workflow when %s', async (_, seed, failures, exitCode) => {
    // Given
    const instance = fakeInstance({ ...seed, workflows: [remoteOf(local('a'), 'abc', [{ id: 't1', name: 'n8nlift:a' }])] }, failures);

    // When
    const plan = await planDeploy({ workflows: [local('a'), local('b')], client: instance.client });

    // Then
    expect(plan.steps).toEqual([]);
    expect(plan.exitCode).toBe(exitCode);
    expect(instance.calls).not.toContain('get abc');
    expect(instance.calls).not.toContain('listTags');
  });

  test('Should word the restore warning conditionally in a dry run', async () => {
    // Given
    const workflow = local('crm');
    const tags = [{ id: 't1', name: 'n8nlift:crm' }];
    const instance = fakeInstance({
      workflows: [
        { ...remoteOf(workflow, 'arc1', tags), isArchived: true },
        { ...remoteOf(workflow, 'arc2', tags), isArchived: true },
      ],
    });

    // When
    const plan = await planDeploy({ workflows: [workflow], client: instance.client });

    // Then
    expect(plan.warnings).toEqual([
      'crm: workflow arc1 was archived in n8n; deploy would bring it back as an unpublished draft',
      'crm: archived workflows arc1 and arc2 all carry the tag n8nlift:crm; deploy would restore arc1',
    ]);
    expect(instance.calls).toEqual(['list', 'spec']);
  });
});
