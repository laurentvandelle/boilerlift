import { describe, expect, test } from 'vitest';
import { fakeLocalWorkflow, fakeNode } from '#src/core/compile/workflow.fake';
import { fakeManaged } from '#src/core/lock/lock-file.fake';
import { fakeN8n, fakeN8nWorkflow, httpError, invalidResponse, unreachable } from '#src/core/n8n/n8n.fake';
import { readStatus } from '#src/core/status/status';
import { StatusFilter } from '#src/core/status/status.model';

const ALL: StatusFilter = { managed: true, unmanaged: true, archived: false };
const CRM = fakeLocalWorkflow('crm-import', { name: 'CRM import' });
const REPORT = fakeLocalWorkflow('daily-report', { name: 'Daily report' });
const HAND_MADE = fakeLocalWorkflow('hand-made', { name: 'Hand made' });

describe('readStatus', () => {
  test('Should report a workflow missing when the lock file records no id for it', async () => {
    const n8n = fakeN8n();

    const report = await readStatus({ workflows: [CRM], client: n8n.client, managed: fakeManaged(), removed: fakeManaged(), filter: ALL });

    expect(report.workflows).toEqual([{ stableName: 'crm-import', path: CRM.path, name: 'CRM import', state: 'missing' }]);
  });

  test('Should report a workflow missing with its recorded id when that id answers 404', async () => {
    const n8n = fakeN8n();

    const report = await readStatus({ workflows: [CRM], client: n8n.client, managed: fakeManaged({ 'crm-import': 'gone' }), removed: fakeManaged(), filter: ALL });

    expect(report.workflows).toEqual([expect.objectContaining({ stableName: 'crm-import', state: 'missing', previousId: 'gone' })]);
  });

  test('Should report a workflow archived when n8n archived it, even when its content differs', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(CRM, { id: 'crm1', isArchived: true, name: 'Renamed' })] });

    const report = await readStatus({ workflows: [CRM], client: n8n.client, managed: fakeManaged({ 'crm-import': 'crm1' }), removed: fakeManaged(), filter: ALL });

    expect(report.workflows).toEqual([expect.objectContaining({ stableName: 'crm-import', state: 'archived', id: 'crm1' })]);
  });

  test('Should report a workflow differing when the n8n draft holds other content, even when it is not published', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(CRM, { id: 'crm1', nodes: [fakeNode({ name: 'Other' })], activeVersionId: null })] });

    const report = await readStatus({ workflows: [CRM], client: n8n.client, managed: fakeManaged({ 'crm-import': 'crm1' }), removed: fakeManaged(), filter: ALL });

    expect(report.workflows).toEqual([expect.objectContaining({ stableName: 'crm-import', state: 'differs', id: 'crm1' })]);
  });

  test('Should report a draft pending when the draft holds the local content but another version is published', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(CRM, { id: 'crm1', versionId: 'v2', activeVersionId: 'v1' })] });

    const report = await readStatus({ workflows: [CRM], client: n8n.client, managed: fakeManaged({ 'crm-import': 'crm1' }), removed: fakeManaged(), filter: ALL });

    expect(report.workflows).toEqual([expect.objectContaining({ stableName: 'crm-import', state: 'draft-pending' })]);
  });

  test('Should report a draft pending when the workflow has no published version', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(CRM, { id: 'crm1', activeVersionId: null })] });

    const report = await readStatus({ workflows: [CRM], client: n8n.client, managed: fakeManaged({ 'crm-import': 'crm1' }), removed: fakeManaged(), filter: ALL });

    expect(report.workflows).toEqual([expect.objectContaining({ stableName: 'crm-import', state: 'draft-pending' })]);
  });

  test('Should report a workflow up to date when the published version is its draft and holds the local content', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(CRM, { id: 'crm1' })] });

    const report = await readStatus({ workflows: [CRM], client: n8n.client, managed: fakeManaged({ 'crm-import': 'crm1' }), removed: fakeManaged(), filter: ALL });

    expect(report).toEqual({ workflows: [expect.objectContaining({ stableName: 'crm-import', state: 'up-to-date', id: 'crm1' })], exitCode: 0 });
  });

  test('Should list the instance workflows the lock file does not record after the project ones when nothing filters them', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(HAND_MADE, { id: 'h1' }), fakeN8nWorkflow(CRM, { id: 'crm1' })] });

    const report = await readStatus({ workflows: [CRM], client: n8n.client, managed: fakeManaged({ 'crm-import': 'crm1' }), removed: fakeManaged(), filter: ALL });

    expect(report.workflows).toEqual([
      expect.objectContaining({ stableName: 'crm-import', state: 'up-to-date' }),
      { state: 'unmanaged', id: 'h1', name: 'Hand made', isArchived: false },
    ]);
  });

  test('Should leave out archived unmanaged workflows when --archived is not given', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(HAND_MADE, { id: 'h1', isArchived: true })] });

    const report = await readStatus({ workflows: [], client: n8n.client, managed: fakeManaged(), removed: fakeManaged(), filter: ALL });

    expect(report.workflows).toEqual([]);
  });

  test('Should list archived unmanaged workflows when --archived is given', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(HAND_MADE, { id: 'h1', isArchived: true })] });

    const report = await readStatus({ workflows: [], client: n8n.client, managed: fakeManaged(), removed: fakeManaged(), filter: { ...ALL, archived: true } });

    expect(report.workflows).toEqual([{ state: 'unmanaged', id: 'h1', name: 'Hand made', isArchived: true }]);
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

  test('Should leave the removed entries out when project workflows are filtered out', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(REPORT, { id: 'old1' })] });

    const report = await readStatus({
      workflows: [],
      client: n8n.client,
      managed: fakeManaged({ 'daily-report': 'old1' }),
      removed: fakeManaged({ 'daily-report': 'old1' }),
      filter: { ...ALL, managed: false },
    });

    expect(report.workflows).toEqual([]);
  });

  test('Should only read when it reports where every workflow stands', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(CRM, { id: 'crm1', isArchived: true }), fakeN8nWorkflow(REPORT, { id: 'rep1' })] });

    await readStatus({ workflows: [CRM, REPORT], client: n8n.client, managed: fakeManaged({ 'crm-import': 'crm1', 'daily-report': 'gone' }), removed: fakeManaged(), filter: ALL });

    expect(n8n.calls.every((call) => call.startsWith('GET '))).toBe(true);
  });

  test('Should stop with exit 4 when the instance rejects the API key', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(CRM, { id: 'crm1' })], failures: [httpError('GET /api/v1/workflows/crm1', 401)] });

    const report = await readStatus({ workflows: [CRM], client: n8n.client, managed: fakeManaged({ 'crm-import': 'crm1' }), removed: fakeManaged(), filter: ALL });

    expect(report).toEqual({
      workflows: [],
      error: { kind: 'key-rejected', call: 'GET /api/v1/workflows/crm1', detail: 'HTTP 401' },
      exitCode: 4,
    });
  });

  test('Should stop with exit 3 when the instance cannot be reached', async () => {
    const n8n = fakeN8n({ failures: [unreachable('GET /api/v1/workflows', 'connection refused')] });

    const report = await readStatus({ workflows: [], client: n8n.client, managed: fakeManaged(), removed: fakeManaged(), filter: ALL });

    expect(report).toEqual({
      workflows: [],
      error: { kind: 'unreachable', call: 'GET /api/v1/workflows', detail: 'unreachable: connection refused' },
      exitCode: 3,
    });
  });

  test('Should stop with exit 3 when the instance answers something that is not the n8n API', async () => {
    const n8n = fakeN8n({ failures: [invalidResponse('GET /api/v1/workflows')] });

    const report = await readStatus({ workflows: [], client: n8n.client, managed: fakeManaged(), removed: fakeManaged(), filter: ALL });

    expect(report).toMatchObject({ error: { kind: 'unreachable', call: 'GET /api/v1/workflows' }, exitCode: 3 });
  });

  test('Should stop with exit 3 when a read answers another HTTP error', async () => {
    const n8n = fakeN8n({ failures: [httpError('GET /api/v1/workflows', 500, 'boom')] });

    const report = await readStatus({ workflows: [], client: n8n.client, managed: fakeManaged(), removed: fakeManaged(), filter: ALL });

    expect(report).toMatchObject({ error: { kind: 'read-failed', detail: 'HTTP 500: boom' }, exitCode: 3 });
  });
});
