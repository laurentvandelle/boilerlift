import { describe, expect, test } from 'vitest';
import { applyClean, planClean } from '#src/core/clean/clean';
import { CleanPlan, RemovedWorkflow } from '#src/core/clean/clean.model';
import { fakeLocalWorkflow, fakeStableName } from '#src/core/compile/workflow.fake';
import { err, ok } from '#src/core/common/result';
import { lockRemover, managedIds, parseLockFile } from '#src/core/deliver/lock-file';
import { LockRemover } from '#src/core/deliver/lock-file.model';
import { FAKE_INSTANCE, fakeLockText, fakeManaged } from '#src/core/deliver/lock-file.fake';
import { FakeN8n, fakeN8n, fakeN8nWorkflow, fakeWorkflowId, httpError, unreachable } from '#src/core/n8n/n8n.fake';

const CRM = fakeLocalWorkflow('crm-import', { path: 'workflows/crm-import.json', name: 'CRM import' });
const OLD = fakeLocalWorkflow('old-report', { name: 'Old report' });
const LEGACY = fakeLocalWorkflow('legacy', { name: 'Legacy' });
const HAND_MADE = fakeLocalWorkflow('hand-made', { name: 'Hand made' });
const NEW = { stableName: fakeStableName('invoice-sync'), path: 'workflows/invoice-sync.json' };

/** OLD is on the instance, LEGACY archived; one hand-made workflow, and one archived one. */
function instance(): FakeN8n {
  return fakeN8n({
    workflows: [
      fakeN8nWorkflow(CRM, { id: 'crm1' }),
      fakeN8nWorkflow(OLD, { id: 'old1' }),
      fakeN8nWorkflow(LEGACY, { id: 'leg1', isArchived: true }),
      fakeN8nWorkflow(HAND_MADE, { id: 'h1' }),
      fakeN8nWorkflow(HAND_MADE, { id: 'h2', name: 'Old hand made', isArchived: true }),
    ],
  });
}

function removedOf(plan: CleanPlan): RemovedWorkflow[] {
  if (plan.kind !== 'ready') {
    throw new Error(`the plan stopped: ${plan.error.detail}`);
  }
  return plan.removed;
}

/** The real lockRemover over an in-memory file that starts with `entries`, and what it holds now. */
function memoryLock(entries: Record<string, string>, failWith?: string): { remover: LockRemover; recorded: () => Record<string, string> } {
  const start = parseLockFile(fakeLockText(entries));
  if (!start.ok) {
    throw new Error(start.error.detail);
  }
  let current = start.value;
  const remover = lockRemover(start.value, (text) => {
    if (failWith !== undefined) {
      return Promise.resolve(err({ reason: failWith }));
    }
    const next = parseLockFile(text);
    if (next.ok) {
      current = next.value;
    }
    return Promise.resolve(ok(undefined));
  });
  return { remover, recorded: () => Object.fromEntries(managedIds(current, FAKE_INSTANCE)) };
}

const MANAGED = { 'crm-import': 'crm1', 'old-report': 'old1', legacy: 'leg1', gone: 'gone1' };
const REMOVED = { 'old-report': 'old1', legacy: 'leg1', gone: 'gone1' };

describe('planClean', () => {
  test('Should list the removed workflows by where they stand on n8n when the lock file records them without a file', async () => {
    const n8n = instance();

    const plan = await planClean({ client: n8n.client, managed: fakeManaged(MANAGED), removed: fakeManaged(REMOVED), files: [] });

    expect(removedOf(plan)).toEqual([
      { stableName: 'gone', id: 'gone1', state: 'not-found' },
      { stableName: 'legacy', id: 'leg1', name: 'Legacy', state: 'already-archived' },
      { stableName: 'old-report', id: 'old1', name: 'Old report', state: 'to-archive' },
    ]);
  });

  test('Should list the local files with no lock entry as not deployed when they were never deployed', async () => {
    const n8n = instance();
    const files = [CRM.path, NEW.path];

    const plan = await planClean({ client: n8n.client, managed: fakeManaged(MANAGED), removed: fakeManaged(), files });

    expect(plan).toMatchObject({ kind: 'ready', notDeployed: [NEW] });
  });

  test('Should list the workflows the lock file does not record, archived ones left out, when it reads the instance', async () => {
    const n8n = instance();

    const plan = await planClean({ client: n8n.client, managed: fakeManaged(MANAGED), removed: fakeManaged(), files: [] });

    expect(plan).toMatchObject({ kind: 'ready', unmanaged: [{ id: 'h1', name: 'Hand made' }] });
  });

  test('Should only read when it plans', async () => {
    const n8n = instance();

    await planClean({ client: n8n.client, managed: fakeManaged(MANAGED), removed: fakeManaged(REMOVED), files: [] });

    expect(n8n.calls.every((call) => call.startsWith('GET '))).toBe(true);
  });

  test('Should stop with exit 3 when a read cannot reach the instance', async () => {
    const n8n = fakeN8n({ failures: [unreachable('GET /api/v1/workflows/old1', 'connection refused')] });

    const plan = await planClean({ client: n8n.client, managed: fakeManaged(MANAGED), removed: fakeManaged({ 'old-report': 'old1' }), files: [] });

    expect(plan).toEqual({
      kind: 'stopped',
      error: { kind: 'unreachable', call: 'GET /api/v1/workflows/old1', detail: 'unreachable: connection refused' },
      exitCode: 3,
    });
  });

  test('Should stop with exit 4 when the instance rejects the API key', async () => {
    const n8n = fakeN8n({ failures: [httpError('GET /api/v1/workflows', 401)] });

    const plan = await planClean({ client: n8n.client, managed: fakeManaged(), removed: fakeManaged(), files: [] });

    expect(plan).toMatchObject({ kind: 'stopped', exitCode: 4 });
  });
});

describe('applyClean', () => {
  test('Should archive the workflow and drop its lock entry when it is still on the instance', async () => {
    const n8n = instance();
    const lock = memoryLock(MANAGED);
    const removed = removedOf(await planClean({ client: n8n.client, managed: fakeManaged(MANAGED), removed: fakeManaged(REMOVED), files: [] }));

    const report = await applyClean(removed, n8n.client, FAKE_INSTANCE, lock.remover);

    expect(report).toEqual({
      results: [
        { stableName: 'gone', id: 'gone1', name: null, action: 'not-found' },
        { stableName: 'legacy', id: 'leg1', name: 'Legacy', action: 'already-archived' },
        { stableName: 'old-report', id: 'old1', name: 'Old report', action: 'archived' },
      ],
      exitCode: 0,
    });
    expect(lock.recorded()).toEqual({ 'crm-import': 'crm1' });
    expect(n8n.workflows.find(({ id }) => id === 'old1')).toMatchObject({ isArchived: true });
  });

  test('Should archive only the workflows still on the instance when some are already archived or gone', async () => {
    const n8n = instance();
    const removed = removedOf(await planClean({ client: n8n.client, managed: fakeManaged(MANAGED), removed: fakeManaged(REMOVED), files: [] }));

    await applyClean(removed, n8n.client, FAKE_INSTANCE, memoryLock(MANAGED).remover);

    expect(n8n.calls.filter((call) => call.startsWith('POST '))).toEqual(['POST /api/v1/workflows/old1/archive']);
  });

  test('Should keep the entry, carry on and exit 5 when one archive is refused for a missing scope', async () => {
    const n8n = fakeN8n({
      workflows: [fakeN8nWorkflow(OLD, { id: 'old1' }), fakeN8nWorkflow(LEGACY, { id: 'leg1' })],
      failures: [httpError('POST /api/v1/workflows/leg1/archive', 403, 'Forbidden')],
    });
    const lock = memoryLock({ 'old-report': 'old1', legacy: 'leg1' });
    const removed: RemovedWorkflow[] = [
      { stableName: fakeStableName('legacy'), id: fakeWorkflowId('leg1'), name: 'Legacy', state: 'to-archive' },
      { stableName: fakeStableName('old-report'), id: fakeWorkflowId('old1'), name: 'Old report', state: 'to-archive' },
    ];

    const report = await applyClean(removed, n8n.client, FAKE_INSTANCE, lock.remover);

    expect(report).toEqual({
      results: [
        {
          stableName: 'legacy',
          id: 'leg1',
          name: 'Legacy',
          action: 'failed',
          error: { kind: 'scope-missing', call: 'POST /api/v1/workflows/leg1/archive', detail: 'HTTP 403: Forbidden' },
        },
        { stableName: 'old-report', id: 'old1', name: 'Old report', action: 'archived' },
      ],
      exitCode: 5,
    });
    expect(lock.recorded()).toEqual({ legacy: 'leg1' });
  });

  test('Should drop the entry as not found when the workflow disappears between the read and the archive', async () => {
    const n8n = fakeN8n();
    const lock = memoryLock({ 'old-report': 'old1' });
    const removed: RemovedWorkflow[] = [{ stableName: fakeStableName('old-report'), id: fakeWorkflowId('old1'), name: 'Old report', state: 'to-archive' }];

    const report = await applyClean(removed, n8n.client, FAKE_INSTANCE, lock.remover);

    expect(report.results).toEqual([{ stableName: 'old-report', id: 'old1', name: 'Old report', action: 'not-found' }]);
    expect(lock.recorded()).toEqual({});
  });

  test('Should fail the workflow with lock-write-failed and exit 5 when the lock file cannot be written', async () => {
    const n8n = instance();
    const removed: RemovedWorkflow[] = [{ stableName: fakeStableName('old-report'), id: fakeWorkflowId('old1'), name: 'Old report', state: 'to-archive' }];

    const report = await applyClean(removed, n8n.client, FAKE_INSTANCE, memoryLock({ 'old-report': 'old1' }, 'disk full').remover);

    expect(report).toEqual({
      results: [
        {
          stableName: 'old-report',
          id: 'old1',
          name: 'Old report',
          action: 'failed',
          error: {
            kind: 'lock-write-failed',
            call: 'write boilerlift.lock.json',
            detail: 'workflow old1 was archived, but boilerlift.lock.json could not be written: disk full',
          },
        },
      ],
      exitCode: 5,
    });
  });
});
