import { describe, expect, test } from 'vitest';
import { fakeLocalWorkflow } from '#src/core/compile/workflow.fake';
import { fakeManaged } from '#src/core/lock/lock-file.fake';
import { fakeN8n, fakeN8nWorkflow, httpError } from '#src/core/n8n/n8n.fake';
import { readStatus } from '#src/core/status/status';
import { StatusFilter } from '#src/core/status/status.model';

const ALL: StatusFilter = { managed: true, unmanaged: true, archived: false };
const CRM = fakeLocalWorkflow('crm-import', { name: 'CRM import' });
const REPORT = fakeLocalWorkflow('daily-report', { name: 'Daily report' });
const HAND_MADE = fakeLocalWorkflow('hand-made', { name: 'Hand made' });

describe('readStatus', () => {
  test('Should report a workflow missing with its recorded id when that id answers 404', async () => {
    const n8n = fakeN8n();

    const report = await readStatus({ workflows: [CRM], client: n8n.client, managed: fakeManaged({ 'crm-import': 'gone' }), removed: fakeManaged(), filter: ALL });

    expect(report.workflows).toEqual([expect.objectContaining({ stableName: 'crm-import', state: 'missing', previousId: 'gone' })]);
  });

  test('Should read only the project workflows when unmanaged ones are filtered out', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(CRM, { id: 'crm1' }), fakeN8nWorkflow(HAND_MADE, { id: 'h1' })] });

    const report = await readStatus({
      workflows: [CRM],
      client: n8n.client,
      managed: fakeManaged({ 'crm-import': 'crm1' }),
      removed: fakeManaged(),
      filter: { ...ALL, unmanaged: false },
    });

    expect(report.workflows).toEqual([expect.objectContaining({ stableName: 'crm-import' })]);
    expect(n8n.calls).toEqual(['GET /api/v1/workflows/crm1']);
  });

  test('Should read only the unmanaged workflows when project ones are filtered out', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(CRM, { id: 'crm1' }), fakeN8nWorkflow(HAND_MADE, { id: 'h1' })] });

    const report = await readStatus({
      workflows: [CRM],
      client: n8n.client,
      managed: fakeManaged({ 'crm-import': 'crm1' }),
      removed: fakeManaged(),
      filter: { ...ALL, managed: false },
    });

    expect(report.workflows).toEqual([expect.objectContaining({ state: 'unmanaged', id: 'h1' })]);
    expect(n8n.calls).toEqual(['GET /api/v1/workflows']);
  });

  test('Should report a removed entry after the project workflows, without reading it, when no file points to it', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(CRM, { id: 'crm1' }), fakeN8nWorkflow(REPORT, { id: 'old1' })] });

    const report = await readStatus({
      workflows: [CRM],
      client: n8n.client,
      managed: fakeManaged({ 'crm-import': 'crm1', 'daily-report': 'old1' }),
      removed: fakeManaged({ 'daily-report': 'old1' }),
      filter: ALL,
    });

    expect(report.workflows).toEqual([
      expect.objectContaining({ stableName: 'crm-import', state: 'up-to-date' }),
      { state: 'removed', stableName: 'daily-report', id: 'old1' },
    ]);
    expect(n8n.calls).toEqual(['GET /api/v1/workflows/crm1', 'GET /api/v1/workflows']);
  });

  test('Should only read when it reports where every workflow stands', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(CRM, { id: 'crm1', isArchived: true }), fakeN8nWorkflow(REPORT, { id: 'rep1' })] });

    await readStatus({ workflows: [CRM, REPORT], client: n8n.client, managed: fakeManaged({ 'crm-import': 'crm1', 'daily-report': 'gone' }), removed: fakeManaged(), filter: ALL });

    expect(n8n.calls.every((call) => call.startsWith('GET '))).toBe(true);
  });

  test('Should stop reading, without listing the workflows, with exit 4 when the instance rejects the API key', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(CRM, { id: 'crm1' })], failures: [httpError('GET /api/v1/workflows/crm1', 401)] });

    const report = await readStatus({ workflows: [CRM], client: n8n.client, managed: fakeManaged({ 'crm-import': 'crm1' }), removed: fakeManaged(), filter: ALL });

    expect(report).toEqual({
      workflows: [],
      error: { kind: 'key-rejected', call: 'GET /api/v1/workflows/crm1', detail: 'HTTP 401' },
      exitCode: 4,
    });
    expect(n8n.calls).toEqual(['GET /api/v1/workflows/crm1']);
  });

});
