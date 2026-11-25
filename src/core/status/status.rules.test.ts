import { describe, expect, test } from 'vitest';
import { fakeLocalWorkflow, fakeNode } from '#src/core/compile/workflow.fake';
import { LocalWorkflow } from '#src/core/compile/workflow.model';
import { Result, err, ok } from '#src/core/common/result';
import { fakeManaged } from '#src/core/lock/lock-file.fake';
import { fakeN8nWorkflow, fakeWorkflowId, httpError, invalidResponse, unreachable } from '#src/core/n8n/n8n.fake';
import { ApiAnswer, ApiFailure, N8nListedWorkflow, N8nWorkflow } from '#src/core/n8n/n8n.model';
import { ManagedRead, StatusFilter, StatusReads } from '#src/core/status/status.model';
import { decideStatus } from '#src/core/status/status.rules';

const ALL: StatusFilter = { managed: true, unmanaged: true, archived: false };
const CRM = fakeLocalWorkflow('crm-import', { name: 'CRM import' });
const HAND_MADE = fakeLocalWorkflow('hand-made', { name: 'Hand made' });
const LIST = 'GET /api/v1/workflows';
const NONE = { managed: fakeManaged(), removed: fakeManaged(), filter: ALL };

/** The read of `workflow` by its recorded `id`: the draft n8n answered with, or the failure. */
function read(workflow: LocalWorkflow, id: string, draft: N8nWorkflow | ApiFailure): ManagedRead {
  const answer: Result<ApiAnswer<N8nWorkflow>, ApiFailure> = 'kind' in draft ? err(draft) : ok({ call: `GET /api/v1/workflows/${id}`, status: 200, body: draft });
  return { workflow, id: fakeWorkflowId(id), draft: answer };
}

function listed(workflows: N8nListedWorkflow[]): StatusReads['listed'] {
  return ok({ call: LIST, status: 200, body: workflows });
}

describe('decideStatus', () => {
  test('Should report a workflow missing when the lock file records no id for it', () => {
    const report = decideStatus(NONE, { managed: [{ workflow: CRM }] });

    expect(report.workflows).toEqual([{ stableName: 'crm-import', path: CRM.path, name: 'CRM import', state: 'missing' }]);
  });

  test('Should report a workflow missing with its recorded id when that id answers 404', () => {
    const report = decideStatus(NONE, { managed: [read(CRM, 'gone', httpError('GET /api/v1/workflows/gone', 404))] });

    expect(report.workflows).toEqual([expect.objectContaining({ stableName: 'crm-import', state: 'missing', previousId: 'gone' })]);
  });

  test('Should report a workflow archived when n8n archived it, even when its content differs', () => {
    const report = decideStatus(NONE, { managed: [read(CRM, 'crm1', fakeN8nWorkflow(CRM, { id: 'crm1', isArchived: true, name: 'Renamed' }))] });

    expect(report.workflows).toEqual([expect.objectContaining({ stableName: 'crm-import', state: 'archived', id: 'crm1' })]);
  });

  test('Should report a workflow differing when the n8n draft holds other content, even when it is not published', () => {
    const draft = fakeN8nWorkflow(CRM, { id: 'crm1', nodes: [fakeNode({ name: 'Other' })], activeVersionId: null });

    const report = decideStatus(NONE, { managed: [read(CRM, 'crm1', draft)] });

    expect(report.workflows).toEqual([expect.objectContaining({ stableName: 'crm-import', state: 'differs', id: 'crm1' })]);
  });

  test('Should report a draft pending when the draft holds the local content but another version is published', () => {
    const report = decideStatus(NONE, { managed: [read(CRM, 'crm1', fakeN8nWorkflow(CRM, { id: 'crm1', versionId: 'v2', activeVersionId: 'v1' }))] });

    expect(report.workflows).toEqual([expect.objectContaining({ stableName: 'crm-import', state: 'draft-pending', id: 'crm1' })]);
  });

  test('Should report a draft pending when the workflow has no published version', () => {
    const report = decideStatus(NONE, { managed: [read(CRM, 'crm1', fakeN8nWorkflow(CRM, { id: 'crm1', activeVersionId: null }))] });

    expect(report.workflows).toEqual([expect.objectContaining({ stableName: 'crm-import', state: 'draft-pending', id: 'crm1' })]);
  });

  test('Should report a workflow up to date when the published version is its draft and holds the local content', () => {
    const report = decideStatus(NONE, { managed: [read(CRM, 'crm1', fakeN8nWorkflow(CRM, { id: 'crm1' }))] });

    expect(report).toEqual({ workflows: [expect.objectContaining({ stableName: 'crm-import', state: 'up-to-date', id: 'crm1' })], exitCode: 0 });
  });

  test('Should list the instance workflows the lock file does not record after the project ones when nothing filters them', () => {
    const reads = { managed: [read(CRM, 'crm1', fakeN8nWorkflow(CRM, { id: 'crm1' }))], listed: listed([fakeN8nWorkflow(HAND_MADE, { id: 'h1' }), fakeN8nWorkflow(CRM, { id: 'crm1' })]) };

    const report = decideStatus({ ...NONE, managed: fakeManaged({ 'crm-import': 'crm1' }) }, reads);

    expect(report.workflows).toEqual([
      expect.objectContaining({ stableName: 'crm-import', state: 'up-to-date' }),
      { state: 'unmanaged', id: 'h1', name: 'Hand made', isArchived: false },
    ]);
  });

  test('Should leave out archived unmanaged workflows when --archived is not given', () => {
    const report = decideStatus(NONE, { managed: [], listed: listed([fakeN8nWorkflow(HAND_MADE, { id: 'h1', isArchived: true })]) });

    expect(report.workflows).toEqual([]);
  });

  test('Should list archived unmanaged workflows when --archived is given', () => {
    const reads = { managed: [], listed: listed([fakeN8nWorkflow(HAND_MADE, { id: 'h1', isArchived: true })]) };

    const report = decideStatus({ ...NONE, filter: { ...ALL, archived: true } }, reads);

    expect(report.workflows).toEqual([{ state: 'unmanaged', id: 'h1', name: 'Hand made', isArchived: true }]);
  });

  test('Should report the removed entries by stable name after the project workflows when project workflows are shown', () => {
    const removed = fakeManaged({ zeta: 'z1', alpha: 'a1' });

    const report = decideStatus({ ...NONE, removed, filter: { ...ALL, unmanaged: false } }, { managed: [{ workflow: CRM }] });

    expect(report.workflows).toEqual([
      expect.objectContaining({ stableName: 'crm-import', state: 'missing' }),
      { state: 'removed', stableName: 'alpha', id: 'a1' },
      { state: 'removed', stableName: 'zeta', id: 'z1' },
    ]);
  });

  test('Should leave the removed entries out when project workflows are filtered out', () => {
    const report = decideStatus({ ...NONE, removed: fakeManaged({ 'daily-report': 'old1' }), filter: { ...ALL, managed: false } }, { managed: [], listed: listed([]) });

    expect(report.workflows).toEqual([]);
  });

  test('Should stop with exit 4 when the instance rejects the API key', () => {
    const report = decideStatus(NONE, { managed: [read(CRM, 'crm1', httpError('GET /api/v1/workflows/crm1', 401))] });

    expect(report).toEqual({
      workflows: [],
      error: { kind: 'key-rejected', call: 'GET /api/v1/workflows/crm1', detail: 'HTTP 401' },
      exitCode: 4,
    });
  });

  test('Should stop with exit 3 when the instance cannot be reached', () => {
    const report = decideStatus(NONE, { managed: [], listed: err(unreachable(LIST, 'connection refused')) });

    expect(report).toEqual({
      workflows: [],
      error: { kind: 'unreachable', call: LIST, detail: 'unreachable: connection refused' },
      exitCode: 3,
    });
  });

  test('Should stop with exit 3 when the instance answers something that is not the n8n API', () => {
    const report = decideStatus(NONE, { managed: [], listed: err(invalidResponse(LIST)) });

    expect(report).toMatchObject({ error: { kind: 'unreachable', call: LIST }, exitCode: 3 });
  });

  test('Should stop with exit 3 when a read answers another HTTP error', () => {
    const report = decideStatus(NONE, { managed: [], listed: err(httpError(LIST, 500, 'boom')) });

    expect(report).toMatchObject({ error: { kind: 'read-failed', detail: 'HTTP 500: boom' }, exitCode: 3 });
  });
});
