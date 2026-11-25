import { describe, expect, test } from 'vitest';
import { fakeLocalWorkflow, fakeStableName } from '#src/core/compile/workflow.fake';
import { err, ok } from '#src/core/common/result';
import { lockRemover, managedIds, parseLockFile } from '#src/core/lock/lock-file';
import { LockRemover } from '#src/core/lock/lock-file.model';
import { FAKE_INSTANCE, fakeLockText, fakeManaged } from '#src/core/lock/lock-file.fake';
import { FakeN8n, fakeN8n, fakeN8nWorkflow, fakeWorkflowId, httpError, unreachable } from '#src/core/n8n/n8n.fake';
import { applyRemoval, readWorkflowsToRemove } from '#src/core/removal/removal';
import { RemovalMode, WorkflowToRemove } from '#src/core/removal/removal.model';

const CRM = fakeLocalWorkflow('crm-import', { name: 'CRM import' });
const OLD = fakeLocalWorkflow('old-report', { name: 'Old report' });
const LEGACY = fakeLocalWorkflow('legacy', { name: 'Legacy' });

/** CRM and OLD are on the instance, LEGACY is archived. */
function instance(): FakeN8n {
  return fakeN8n({
    workflows: [
      fakeN8nWorkflow(CRM, { id: 'crm1' }),
      fakeN8nWorkflow(OLD, { id: 'old1' }),
      fakeN8nWorkflow(LEGACY, { id: 'leg1', isArchived: true }),
    ],
  });
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

/** The workflows of REMOVED, read from `n8n` in `mode`. */
async function planned(n8n: FakeN8n, mode: RemovalMode): Promise<WorkflowToRemove[]> {
  const read = await readWorkflowsToRemove(n8n.client, fakeManaged(REMOVED), mode);
  if (!read.ok) {
    throw new Error(`the read stopped: ${read.error.detail}`);
  }
  return read.value;
}

describe('readWorkflowsToRemove', () => {
  test('Should read each entry by its recorded id, in stable-name order, when the mode is archive', async () => {
    const n8n = instance();

    const read = await readWorkflowsToRemove(n8n.client, fakeManaged(REMOVED), 'archive');

    expect(read).toEqual(ok([
      { stableName: 'gone', id: 'gone1', state: 'not-found' },
      { stableName: 'legacy', id: 'leg1', name: 'Legacy', state: 'already-archived' },
      { stableName: 'old-report', id: 'old1', name: 'Old report', state: 'to-archive' },
    ]));
    expect(n8n.calls.every((call) => call.startsWith('GET '))).toBe(true);
  });

  test('Should stop with the error of the first read when it cannot reach the instance', async () => {
    const n8n = fakeN8n({ failures: [unreachable('GET /api/v1/workflows/old1', 'connection refused')] });

    const read = await readWorkflowsToRemove(n8n.client, fakeManaged({ 'old-report': 'old1' }), 'archive');

    expect(read).toEqual(err({ kind: 'unreachable', call: 'GET /api/v1/workflows/old1', detail: 'unreachable: connection refused' }));
  });
});

describe('applyRemoval', () => {
  test('Should archive the workflow and drop its lock entry when it is still on the instance', async () => {
    const n8n = instance();
    const lock = memoryLock(MANAGED);
    const removed = await planned(n8n, 'archive');

    const report = await applyRemoval(removed, n8n.client, FAKE_INSTANCE, lock.remover);

    expect(report).toEqual({
      results: [
        { stableName: 'gone', id: 'gone1', name: null, action: 'not-found' },
        { stableName: 'legacy', id: 'leg1', name: 'Legacy', action: 'already-archived' },
        { stableName: 'old-report', id: 'old1', name: 'Old report', action: 'archived' },
      ],
      outcome: 'completed',
    });
    expect(lock.recorded()).toEqual({ 'crm-import': 'crm1' });
    expect(n8n.workflows.find(({ id }) => id === 'old1')).toMatchObject({ isArchived: true });
  });

  test('Should archive only the workflows still on the instance when some are already archived or gone', async () => {
    const n8n = instance();
    const removed = await planned(n8n, 'archive');

    await applyRemoval(removed, n8n.client, FAKE_INSTANCE, memoryLock(MANAGED).remover);

    expect(n8n.calls.filter((call) => call.startsWith('POST '))).toEqual(['POST /api/v1/workflows/old1/archive']);
  });

  test('Should keep the entry, carry on and end partial when one archive is refused for a missing scope', async () => {
    const n8n = fakeN8n({
      workflows: [fakeN8nWorkflow(OLD, { id: 'old1' }), fakeN8nWorkflow(LEGACY, { id: 'leg1' })],
      failures: [httpError('POST /api/v1/workflows/leg1/archive', 403, 'Forbidden')],
    });
    const lock = memoryLock({ 'old-report': 'old1', legacy: 'leg1' });
    const removed: WorkflowToRemove[] = [
      { stableName: fakeStableName('legacy'), id: fakeWorkflowId('leg1'), name: 'Legacy', state: 'to-archive' },
      { stableName: fakeStableName('old-report'), id: fakeWorkflowId('old1'), name: 'Old report', state: 'to-archive' },
    ];

    const report = await applyRemoval(removed, n8n.client, FAKE_INSTANCE, lock.remover);

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
      outcome: 'partial',
    });
    expect(lock.recorded()).toEqual({ legacy: 'leg1' });
  });

  test('Should drop the entry as not found when the workflow disappears between the read and the archive', async () => {
    const n8n = fakeN8n();
    const lock = memoryLock({ 'old-report': 'old1' });
    const removed: WorkflowToRemove[] = [{ stableName: fakeStableName('old-report'), id: fakeWorkflowId('old1'), name: 'Old report', state: 'to-archive' }];

    const report = await applyRemoval(removed, n8n.client, FAKE_INSTANCE, lock.remover);

    expect(report.results).toEqual([{ stableName: 'old-report', id: 'old1', name: 'Old report', action: 'not-found' }]);
    expect(lock.recorded()).toEqual({});
  });

  test('Should fail the workflow with lock-write-failed and end partial when the lock file cannot be written', async () => {
    const n8n = instance();
    const removed: WorkflowToRemove[] = [{ stableName: fakeStableName('old-report'), id: fakeWorkflowId('old1'), name: 'Old report', state: 'to-archive' }];

    const report = await applyRemoval(removed, n8n.client, FAKE_INSTANCE, memoryLock({ 'old-report': 'old1' }, 'disk full').remover);

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
      outcome: 'partial',
    });
  });
});

describe('applyRemoval in delete mode', () => {
  test('Should archive then delete a workflow not archived yet, and drop its lock entry, when the mode is delete', async () => {
    const n8n = instance();
    const lock = memoryLock(MANAGED);

    const report = await applyRemoval(await planned(n8n, 'delete'), n8n.client, FAKE_INSTANCE, lock.remover);

    expect(report.results).toContainEqual({ stableName: 'old-report', id: 'old1', name: 'Old report', action: 'deleted' });
    expect(n8n.calls.filter((call) => !call.startsWith('GET ') && call.includes('old1'))).toEqual([
      'POST /api/v1/workflows/old1/archive',
      'DELETE /api/v1/workflows/old1',
    ]);
    expect(n8n.workflows.some(({ id }) => id === 'old1')).toBe(false);
    expect(lock.recorded()).toEqual({ 'crm-import': 'crm1' });
  });

  test('Should delete a workflow already archived on the instance without archiving it again when the mode is delete', async () => {
    const n8n = instance();

    const report = await applyRemoval(await planned(n8n, 'delete'), n8n.client, FAKE_INSTANCE, memoryLock(MANAGED).remover);

    expect(report.results).toContainEqual({ stableName: 'legacy', id: 'leg1', name: 'Legacy', action: 'deleted' });
    expect(n8n.calls.filter((call) => !call.startsWith('GET ') && call.includes('leg1'))).toEqual(['DELETE /api/v1/workflows/leg1']);
  });

  test('Should only drop the entry as not found when the recorded id answers 404 in delete mode', async () => {
    const n8n = instance();

    const report = await applyRemoval(await planned(n8n, 'delete'), n8n.client, FAKE_INSTANCE, memoryLock(MANAGED).remover);

    expect(report.results).toContainEqual({ stableName: 'gone', id: 'gone1', name: null, action: 'not-found' });
    expect(n8n.calls.filter((call) => call.includes('gone1') && !call.startsWith('GET '))).toEqual([]);
  });

  test('Should fail with delete-failed, keep the workflow archived and its entry, and end partial when the delete fails', async () => {
    const n8n = fakeN8n({
      workflows: [fakeN8nWorkflow(OLD, { id: 'old1' })],
      failures: [httpError('DELETE /api/v1/workflows/old1', 403, 'Forbidden')],
    });
    const lock = memoryLock({ 'old-report': 'old1' });
    const removed: WorkflowToRemove[] = [
      { stableName: fakeStableName('old-report'), id: fakeWorkflowId('old1'), name: 'Old report', state: 'to-delete', isArchived: false },
    ];

    const report = await applyRemoval(removed, n8n.client, FAKE_INSTANCE, lock.remover);

    expect(report).toEqual({
      results: [
        {
          stableName: 'old-report',
          id: 'old1',
          name: 'Old report',
          action: 'failed',
          error: { kind: 'delete-failed', cause: 'scope-missing', call: 'DELETE /api/v1/workflows/old1', detail: 'HTTP 403: Forbidden' },
        },
      ],
      outcome: 'partial',
    });
    expect(n8n.workflows.find(({ id }) => id === 'old1')).toMatchObject({ isArchived: true });
    expect(lock.recorded()).toEqual({ 'old-report': 'old1' });
  });

  test('Should fail with lock-write-failed when the lock file cannot be written after a delete', async () => {
    const n8n = instance();
    const removed: WorkflowToRemove[] = [
      { stableName: fakeStableName('old-report'), id: fakeWorkflowId('old1'), name: 'Old report', state: 'to-delete', isArchived: false },
    ];

    const report = await applyRemoval(removed, n8n.client, FAKE_INSTANCE, memoryLock({ 'old-report': 'old1' }, 'disk full').remover);

    expect(report.results).toEqual([
      {
        stableName: 'old-report',
        id: 'old1',
        name: 'Old report',
        action: 'failed',
        error: {
          kind: 'lock-write-failed',
          call: 'write boilerlift.lock.json',
          detail: 'workflow old1 was deleted, but boilerlift.lock.json could not be written: disk full',
        },
      },
    ]);
  });
});
