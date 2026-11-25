import { describe, expect, test } from 'vitest';
import { fakeLocalWorkflow } from '#src/core/compile/workflow.fake';
import { LocalWorkflow, StableName } from '#src/core/compile/workflow.model';
import { Result, err, ok } from '#src/core/common/result';
import { DeployPlan } from '#src/core/deliver/deploy.model';
import { decideSpec, decideSteps } from '#src/core/deliver/plan-deploy.rules';
import { fakeManaged } from '#src/core/lock/lock-file.fake';
import { fakeN8nWorkflow, httpError, unreachable } from '#src/core/n8n/n8n.fake';
import { ApiAnswer, ApiFailure, N8nWorkflow } from '#src/core/n8n/n8n.model';

const PING_HINT = 'Run lift ping to check the url of the target and your network, then run deploy again';
const SPEC = 'GET /api/v1/openapi.yml';

function draft(workflow: N8nWorkflow): Result<ApiAnswer<N8nWorkflow>, ApiFailure> {
  return ok({ call: `GET /api/v1/workflows/${workflow.id}`, status: 200, body: workflow });
}

function failed(failure: ApiFailure): Result<ApiAnswer<N8nWorkflow>, ApiFailure> {
  return err(failure);
}

function drafts(entries: Record<string, Result<ApiAnswer<N8nWorkflow>, ApiFailure>>): Map<StableName, Result<ApiAnswer<N8nWorkflow>, ApiFailure>> {
  return new Map(Object.entries(entries).map(([name, read]): [StableName, Result<ApiAnswer<N8nWorkflow>, ApiFailure>] => [fakeLocalWorkflow(name).stableName, read]));
}

function actions(plan: DeployPlan): string[][] {
  return plan.steps.map(({ workflow, action }) => [workflow.stableName, action]);
}

function names(...stableNames: string[]): LocalWorkflow[] {
  return stableNames.map((name) => fakeLocalWorkflow(name));
}

describe('decideSpec', () => {
  test('Should let the plan go on when the spec has publishIfActive', () => {
    const error = decideSpec(ok({ call: SPEC, status: 200, body: 'paths:\n  publishIfActive: {}\n' }));

    expect(error).toBeUndefined();
  });

  test('Should stop with drafts unsupported when the spec has no publishIfActive', () => {
    const error = decideSpec(ok({ call: SPEC, status: 200, body: 'paths: {}\n' }));

    expect(error).toMatchObject({ kind: 'drafts-unsupported', call: SPEC, detail: 'the API spec has no publishIfActive: n8n 2.35.0 or later is required' });
  });

  test.each([[404], [500]])('Should stop with drafts unsupported when the spec answers HTTP %s', (status) => {
    const error = decideSpec(err(httpError(SPEC, status)));

    expect(error).toMatchObject({ kind: 'drafts-unsupported', detail: `HTTP ${status}: n8n 2.35.0 or later is required` });
  });

  test('Should stop as unreachable with the ping hint when the spec cannot be reached', () => {
    const error = decideSpec(err(unreachable(SPEC, 'connection reset')));

    expect(error).toMatchObject({ kind: 'unreachable', hint: PING_HINT });
  });
});

describe('decideSteps', () => {
  test('Should plan one action per workflow when the record holds new, gone, changed, unchanged and archived ones', () => {
    const changed = fakeLocalWorkflow('changed');
    const same = fakeLocalWorkflow('same');
    const archived = fakeLocalWorkflow('archived');
    const managed = fakeManaged({ changed: 'idc', same: 'ids', archived: 'ida', gone: 'idg' });
    const reads = drafts({
      changed: draft(fakeN8nWorkflow(changed, { id: 'idc', name: 'Old name' })),
      same: draft(fakeN8nWorkflow(same, { id: 'ids' })),
      archived: draft(fakeN8nWorkflow(archived, { id: 'ida', isArchived: true })),
      gone: failed(httpError('GET /api/v1/workflows/idg', 404)),
    });

    const plan = decideSteps([fakeLocalWorkflow('new'), fakeLocalWorkflow('gone'), changed, same, archived], managed, reads);

    expect(actions(plan)).toEqual([
      ['archived', 'restored'],
      ['changed', 'updated'],
      ['gone', 'recreated'],
      ['new', 'created'],
      ['same', 'skipped'],
    ]);
    expect(plan.outcome).toBe('completed');
  });

  test('Should warn that a workflow is restored when its recorded draft is archived', () => {
    const workflow = fakeLocalWorkflow('a');

    const plan = decideSteps([workflow], fakeManaged({ a: 'ida' }), drafts({ a: draft(fakeN8nWorkflow(workflow, { id: 'ida', isArchived: true })) }));

    expect(plan.warnings).toEqual([{ kind: 'restored', stableName: 'a', id: 'ida' }]);
  });

  test('Should keep the tags of each workflow it read when it plans', () => {
    const workflow = fakeLocalWorkflow('a');
    const instance = fakeN8nWorkflow(workflow, { id: 'ida', name: 'Old name' });

    const plan = decideSteps([workflow], fakeManaged({ a: 'ida' }), drafts({ a: draft(instance) }));

    expect(plan.tags.get(workflow.stableName)).toEqual(instance.tags);
  });

  test('Should fail only that workflow and end partial when its read answers another HTTP error', () => {
    const plan = decideSteps(names('a', 'b'), fakeManaged({ a: 'ida' }), drafts({ a: failed(httpError('GET /api/v1/workflows/ida', 500)) }));

    expect(actions(plan)).toEqual([
      ['a', 'failed'],
      ['b', 'created'],
    ]);
    expect(plan.outcome).toBe('partial');
  });

  test('Should mark every workflow after a failed read not-processed and stop when the instance cannot be reached', () => {
    const managed = fakeManaged({ a: 'ida', b: 'idb' });

    const plan = decideSteps(names('a', 'b', 'c'), managed, drafts({ a: failed(unreachable('GET /api/v1/workflows/ida', 'connection reset')) }));

    expect(actions(plan)).toEqual([
      ['a', 'failed'],
      ['b', 'not-processed'],
      ['c', 'not-processed'],
    ]);
    expect(plan).toMatchObject({ outcome: 'stopped', error: { call: 'GET /api/v1/workflows/ida', kind: 'unreachable', hint: PING_HINT } });
  });

  test('Should mark a recorded workflow not-processed when it has no read', () => {
    const plan = decideSteps(names('a'), fakeManaged({ a: 'ida' }), drafts({}));

    expect(actions(plan)).toEqual([['a', 'not-processed']]);
  });
});
