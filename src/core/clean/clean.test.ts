import { describe, expect, test } from 'vitest';
import { planClean } from '#src/core/clean/clean';
import { CleanPlan } from '#src/core/clean/clean.model';
import { fakeLocalWorkflow, fakeStableName } from '#src/core/compile/workflow.fake';
import { fakeManaged } from '#src/core/deliver/lock-file.fake';
import { FakeN8n, fakeN8n, fakeN8nWorkflow, httpError, unreachable } from '#src/core/n8n/n8n.fake';
import { WorkflowToRemove } from '#src/core/removal/removal.model';

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

function removedOf(plan: CleanPlan): WorkflowToRemove[] {
  if (plan.kind !== 'ready') {
    throw new Error(`the plan stopped: ${plan.error.detail}`);
  }
  return plan.removed;
}

const MANAGED = { 'crm-import': 'crm1', 'old-report': 'old1', legacy: 'leg1', gone: 'gone1' };
const REMOVED = { 'old-report': 'old1', legacy: 'leg1', gone: 'gone1' };

describe('planClean', () => {
  test('Should list the removed workflows by where they stand on n8n when the lock file records them without a file', async () => {
    const n8n = instance();

    const plan = await planClean({ client: n8n.client, managed: fakeManaged(MANAGED), removed: fakeManaged(REMOVED), files: [], mode: 'archive' });

    expect(removedOf(plan)).toEqual([
      { stableName: 'gone', id: 'gone1', state: 'not-found' },
      { stableName: 'legacy', id: 'leg1', name: 'Legacy', state: 'already-archived' },
      { stableName: 'old-report', id: 'old1', name: 'Old report', state: 'to-archive' },
    ]);
  });

  test('Should list the local files with no lock entry as not deployed when they were never deployed', async () => {
    const n8n = instance();
    const files = [CRM.path, NEW.path];

    const plan = await planClean({ client: n8n.client, managed: fakeManaged(MANAGED), removed: fakeManaged(), files, mode: 'archive' });

    expect(plan).toMatchObject({ kind: 'ready', notDeployed: [NEW] });
  });

  test('Should list the workflows the lock file does not record, archived ones left out, when it reads the instance', async () => {
    const n8n = instance();

    const plan = await planClean({ client: n8n.client, managed: fakeManaged(MANAGED), removed: fakeManaged(), files: [], mode: 'archive' });

    expect(plan).toMatchObject({ kind: 'ready', unmanaged: [{ id: 'h1', name: 'Hand made' }] });
  });

  test('Should plan every removed workflow still on the instance as to-delete, archived or not, when the mode is delete', async () => {
    const n8n = instance();

    const plan = await planClean({ client: n8n.client, managed: fakeManaged(MANAGED), removed: fakeManaged(REMOVED), files: [], mode: 'delete' });

    expect(removedOf(plan)).toEqual([
      { stableName: 'gone', id: 'gone1', state: 'not-found' },
      { stableName: 'legacy', id: 'leg1', name: 'Legacy', state: 'to-delete', isArchived: true },
      { stableName: 'old-report', id: 'old1', name: 'Old report', state: 'to-delete', isArchived: false },
    ]);
  });

  test('Should only read when it plans', async () => {
    const n8n = instance();

    await planClean({ client: n8n.client, managed: fakeManaged(MANAGED), removed: fakeManaged(REMOVED), files: [], mode: 'archive' });

    expect(n8n.calls.every((call) => call.startsWith('GET '))).toBe(true);
  });

  test('Should stop with exit 3 when a read cannot reach the instance', async () => {
    const n8n = fakeN8n({ failures: [unreachable('GET /api/v1/workflows/old1', 'connection refused')] });

    const plan = await planClean({ client: n8n.client, managed: fakeManaged(MANAGED), removed: fakeManaged({ 'old-report': 'old1' }), files: [], mode: 'archive' });

    expect(plan).toEqual({
      kind: 'stopped',
      error: { kind: 'unreachable', call: 'GET /api/v1/workflows/old1', detail: 'unreachable: connection refused' },
      exitCode: 3,
    });
  });

  test('Should stop with exit 4 when the instance rejects the API key', async () => {
    const n8n = fakeN8n({ failures: [httpError('GET /api/v1/workflows', 401)] });

    const plan = await planClean({ client: n8n.client, managed: fakeManaged(), removed: fakeManaged(), files: [], mode: 'archive' });

    expect(plan).toMatchObject({ kind: 'stopped', exitCode: 4 });
  });
});
