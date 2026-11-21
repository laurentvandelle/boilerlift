import { describe, expect, test } from 'vitest';
import { fakeLocalWorkflow } from '#src/core/compile/workflow.fake';
import { fakeManaged } from '#src/core/deliver/lock-file.fake';
import { FakeN8n, fakeN8n, fakeN8nWorkflow, httpError } from '#src/core/n8n/n8n.fake';
import { planReset } from '#src/core/reset/reset';

const CRM = fakeLocalWorkflow('crm-import', { name: 'CRM import' });
const REPORT = fakeLocalWorkflow('daily-report', { name: 'Daily report' });
const OLD = fakeLocalWorkflow('old-report', { name: 'Old report' });

/** CRM belongs to dev, REPORT to staging, OLD has no file any more; all three on the instance. */
function instance(): FakeN8n {
  return fakeN8n({
    workflows: [
      fakeN8nWorkflow(CRM, { id: 'crm1' }),
      fakeN8nWorkflow(REPORT, { id: 'rep1' }),
      fakeN8nWorkflow(OLD, { id: 'old1', isArchived: true }),
    ],
  });
}

const MANAGED = { 'crm-import': 'crm1', 'daily-report': 'rep1', 'old-report': 'old1' };
const STAGING = { name: 'staging', stableNames: new Set(['daily-report']) };

describe('planReset', () => {
  test('Should plan the entries of the target and the removed workflows when no other target is on the instance', async () => {
    const n8n = instance();

    const plan = await planReset({ client: n8n.client, managed: fakeManaged(MANAGED), others: [], mode: 'archive' });

    expect(plan).toEqual({
      kind: 'ready',
      workflows: [
        { stableName: 'crm-import', id: 'crm1', name: 'CRM import', state: 'to-archive' },
        { stableName: 'daily-report', id: 'rep1', name: 'Daily report', state: 'to-archive' },
        { stableName: 'old-report', id: 'old1', name: 'Old report', state: 'already-archived' },
      ],
      kept: [],
    });
  });

  test('Should keep and count the entries of another target on the same instance when its folder has their files', async () => {
    const n8n = instance();

    const plan = await planReset({ client: n8n.client, managed: fakeManaged(MANAGED), others: [STAGING], mode: 'archive' });

    expect(plan).toMatchObject({
      kind: 'ready',
      workflows: [{ stableName: 'crm-import' }, { stableName: 'old-report' }],
      kept: [{ target: 'staging', count: 1 }],
    });
  });

  test('Should keep an entry when another target on the instance has its file, even if the target has it too', async () => {
    const n8n = instance();
    const others = [{ name: 'staging', stableNames: new Set(['crm-import', 'daily-report']) }];

    const plan = await planReset({ client: n8n.client, managed: fakeManaged(MANAGED), others, mode: 'archive' });

    expect(plan).toMatchObject({ kind: 'ready', workflows: [{ stableName: 'old-report' }], kept: [{ target: 'staging', count: 2 }] });
  });

  test('Should plan every workflow still on the instance as to-delete when the mode is delete', async () => {
    const n8n = instance();

    const plan = await planReset({ client: n8n.client, managed: fakeManaged({ 'old-report': 'old1' }), others: [], mode: 'delete' });

    expect(plan).toMatchObject({ kind: 'ready', workflows: [{ stableName: 'old-report', state: 'to-delete', isArchived: true }] });
  });

  test('Should plan nothing and make no call when the lock file records nothing for the instance', async () => {
    const n8n = instance();

    const plan = await planReset({ client: n8n.client, managed: fakeManaged(), others: [STAGING], mode: 'archive' });

    expect(plan).toEqual({ kind: 'ready', workflows: [], kept: [{ target: 'staging', count: 0 }] });
    expect(n8n.calls).toEqual([]);
  });

  test('Should only read when it plans', async () => {
    const n8n = instance();

    await planReset({ client: n8n.client, managed: fakeManaged(MANAGED), others: [], mode: 'delete' });

    expect(n8n.calls.every((call) => call.startsWith('GET '))).toBe(true);
  });

  test('Should stop with exit 4 when the instance rejects the API key', async () => {
    const n8n = fakeN8n({ failures: [httpError('GET /api/v1/workflows/crm1', 401)] });

    const plan = await planReset({ client: n8n.client, managed: fakeManaged({ 'crm-import': 'crm1' }), others: [], mode: 'archive' });

    expect(plan).toMatchObject({ kind: 'stopped', exitCode: 4 });
  });
});
