import { describe, expect, test } from 'vitest';
import { fakeCredentialEntry, fakeLocalWorkflowUsing } from '#src/core/compile/credential.fake';
import { CredentialEntry } from '#src/core/compile/credential.model';
import { fakeLocalWorkflow, fakeNode } from '#src/core/compile/workflow.fake';
import { LocalWorkflow, StableName } from '#src/core/compile/workflow.model';
import { deploy } from '#src/core/deliver/deploy';
import { fakeLockWriter, fakeManaged } from '#src/core/lock/lock-file.fake';
import { FakeN8n, fakeCredential, fakeN8n, fakeN8nWorkflow, httpError } from '#src/core/n8n/n8n.fake';
import { WorkflowId } from '#src/core/n8n/n8n.model';
import { readStatus } from '#src/core/status/status';
import { StatusReport } from '#src/core/status/status.model';

const LIST_CALL = 'GET /api/v1/credentials';
const MANAGED_ONLY = { managed: true, unmanaged: false, archived: false };
const INVOICE = fakeLocalWorkflowUsing('invoice-sync', ['gmail-sales']);
const LIST = [fakeCredentialEntry('gmail-sales')];

/** Deploys `workflows` to target `prod` on `n8n`, and returns the ids the lock file then records. */
async function deployed(workflows: LocalWorkflow[], n8n: FakeN8n, credentials: CredentialEntry[]): Promise<Map<StableName, WorkflowId>> {
  const lock = fakeLockWriter();
  await deploy({ workflows, target: 'prod', credentials, client: n8n.client, managed: fakeManaged() }, lock.writer);
  return lock.managed();
}

/** The status of `workflows` on target `prod`, resolving markers through `credentials`. */
function status(workflows: LocalWorkflow[], n8n: FakeN8n, credentials: CredentialEntry[], managed = fakeManaged()): Promise<StatusReport> {
  return readStatus({ workflows, client: n8n.client, managed, removed: fakeManaged(), filter: MANAGED_ONLY, target: 'prod', credentials, command: 'status' });
}

describe('readStatus credentials', () => {
  test('Should report the draft deploy just wrote as not yet published when the workflow picks a credential with credential()', async () => {
    const n8n = fakeN8n({ credentials: [fakeCredential('gmail-sales')] });
    const managed = await deployed([INVOICE], n8n, LIST);

    const report = await status([INVOICE], n8n, LIST, managed);

    expect(report.workflows).toEqual([expect.objectContaining({ stableName: 'invoice-sync', state: 'draft-pending' })]);
  });

  test('Should still report differs when the draft was changed in the n8n editor after the deploy', async () => {
    const n8n = fakeN8n({
      credentials: [fakeCredential('gmail-sales')],
      workflows: [fakeN8nWorkflow(INVOICE, { id: 'inv1', nodes: [fakeNode({ name: 'Changed in n8n', credentials: { httpHeaderAuth: { id: 'gmail-sales-id', name: 'gmail-sales' } } })] })],
    });

    const report = await status([INVOICE], n8n, LIST, fakeManaged({ 'invoice-sync': 'inv1' }));

    expect(report.workflows).toEqual([expect.objectContaining({ stableName: 'invoice-sync', state: 'differs' })]);
  });

  test('Should stop with the missing keys and a status hint when the target lacks a credential', async () => {
    const n8n = fakeN8n({ workflows: [fakeN8nWorkflow(INVOICE, { id: 'inv1' })] });

    const report = await status([INVOICE], n8n, [], fakeManaged({ 'invoice-sync': 'inv1' }));

    expect(report).toEqual({
      workflows: [],
      error: {
        kind: 'credentials-missing',
        call: LIST_CALL,
        detail: '1 credential missing on target prod: gmail-sales',
        hint: 'Run lift creds sync --target prod to update credentials/prod.ts, or create the missing credentials in n8n first, then run status again',
        missing: [{ key: 'gmail-sales', type: 'httpHeaderAuth', reason: 'not-listed', workflows: ['invoice-sync'] }],
      },
    });
  });

  test('Should stop with the missing scope when the API key cannot list credentials and a workflow uses credential()', async () => {
    const n8n = fakeN8n({ failures: [httpError(LIST_CALL, 403, 'Forbidden')] });

    const report = await status([INVOICE], n8n, LIST);

    expect(report.error).toMatchObject({ kind: 'credential-scope-missing', call: LIST_CALL, hint: 'Give the API key of the target the credential:list scope in n8n → Settings → n8n API, or create a key that has it, then run status again' });
  });

  test('Should not list credentials when no workflow uses credential()', async () => {
    const n8n = fakeN8n({ failures: [httpError(LIST_CALL, 403, 'Forbidden')] });

    const report = await status([fakeLocalWorkflow('weekly')], n8n, []);

    expect([report.error, n8n.calls.includes(LIST_CALL)]).toEqual([undefined, false]);
  });
});
