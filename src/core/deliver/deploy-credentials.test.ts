import { describe, expect, test } from 'vitest';
import { fakeCredentialEntry, fakeLocalWorkflowUsing } from '#src/core/compile/credential.fake';
import { CredentialEntry } from '#src/core/compile/credential.model';
import { fakeLocalWorkflow } from '#src/core/compile/workflow.fake';
import { LocalWorkflow } from '#src/core/compile/workflow.model';
import { isRecord } from '#src/core/common/is-record';
import { deploy, previewDeploy } from '#src/core/deliver/deploy';
import { DeployReport } from '#src/core/deliver/deploy.model';
import { fakeLockWriter, fakeManaged } from '#src/core/lock/lock-file.fake';
import { FakeN8n, fakeCredential, fakeN8n, fakeN8nWorkflow, httpError } from '#src/core/n8n/n8n.fake';

const LIST_CALL = 'GET /api/v1/credentials';

/** Deploys `workflows` to target `prod` on `n8n`, resolving markers through `credentials`. */
function run(workflows: LocalWorkflow[], n8n: FakeN8n, credentials: CredentialEntry[], managed = fakeManaged()): Promise<DeployReport> {
  return deploy({ workflows, target: 'prod', credentials, client: n8n.client, managed }, fakeLockWriter().writer);
}

/** The `credentials` of the first node of the workflow named `name` on the instance. */
function credentialsOnInstance(n8n: FakeN8n, name: string): unknown {
  const [node] = n8n.workflows.find((workflow) => workflow.name === name)?.nodes ?? [];
  return isRecord(node) ? node.credentials : undefined;
}

describe('deploy credentials', () => {
  test('Should send the id and name of the target list under its type when a node picks a key with credential()', async () => {
    const n8n = fakeN8n({ credentials: [fakeCredential('gmail-sales', { id: 'g1', type: 'gmailOAuth2' })] });
    const list = [fakeCredentialEntry('gmail-sales', { id: 'g1', type: 'gmailOAuth2' })];

    await run([fakeLocalWorkflowUsing('invoice-sync', ['gmail-sales'], 'unknown')], n8n, list);

    expect(credentialsOnInstance(n8n, 'Workflow invoice-sync')).toEqual({ gmailOAuth2: { id: 'g1', name: 'gmail-sales' } });
  });

  test('Should send the current name when the credential was renamed in n8n under the same id', async () => {
    const n8n = fakeN8n({ credentials: [fakeCredential('Gmail renamed', { id: 'g1' })] });
    const list = [fakeCredentialEntry('gmail-sales', { id: 'g1' })];

    await run([fakeLocalWorkflowUsing('invoice-sync', ['gmail-sales'])], n8n, list);

    expect(credentialsOnInstance(n8n, 'Workflow invoice-sync')).toEqual({ httpHeaderAuth: { id: 'g1', name: 'Gmail renamed' } });
  });

  test('Should stop before any write with exit 8 and each missing key when the target lacks credentials', async () => {
    const n8n = fakeN8n({ credentials: [fakeCredential('gone', { id: 'new-id' }), fakeCredential('retyped', { type: 'slackApi' })] });
    const list = [fakeCredentialEntry('gone'), fakeCredentialEntry('retyped')];
    const workflows = [fakeLocalWorkflowUsing('a', ['gone', 'unlisted']), fakeLocalWorkflowUsing('b', ['retyped', 'unlisted'])];

    const report = await run(workflows, n8n, list);

    expect(report).toMatchObject({
      results: [],
      exitCode: 8,
      error: {
        kind: 'credentials-missing',
        call: LIST_CALL,
        detail: '3 credentials missing on target prod: gone, retyped, unlisted',
        hint: 'Run lift creds sync --target prod to update credentials/prod.ts, or create the missing credentials in n8n first, then run deploy again',
        missing: [
          { key: 'gone', type: 'httpHeaderAuth', id: 'gone-id', reason: 'gone', workflows: ['a'] },
          { key: 'retyped', type: 'httpHeaderAuth', id: 'retyped-id', reason: 'type-changed', workflows: ['b'] },
          { key: 'unlisted', type: 'httpHeaderAuth', reason: 'not-listed', workflows: ['a', 'b'] },
        ],
      },
    });
    expect(n8n.calls.filter((call) => !call.startsWith('GET'))).toEqual([]);
  });

  test('Should report the same missing credentials when a dry run plans the deploy', async () => {
    const n8n = fakeN8n();

    const report = await previewDeploy({ workflows: [fakeLocalWorkflowUsing('a', ['slack'])], target: 'prod', credentials: [], client: n8n.client, managed: fakeManaged() });

    expect(report).toMatchObject({ exitCode: 8, error: { kind: 'credentials-missing', missing: [{ key: 'slack', reason: 'not-listed' }] } });
  });

  test('Should stop before any write with exit 9 when the API key cannot list credentials and workflows use credential()', async () => {
    const n8n = fakeN8n({ failures: [httpError(LIST_CALL, 403, 'Forbidden')] });

    const report = await run([fakeLocalWorkflowUsing('a', ['slack'])], n8n, [fakeCredentialEntry('slack')]);

    expect(report).toMatchObject({
      results: [],
      exitCode: 9,
      error: { kind: 'credential-scope-missing', call: LIST_CALL, detail: 'HTTP 403: Forbidden: the API key lacks the credential:list scope' },
    });
  });

  test('Should deploy without listing credentials when no workflow uses credential()', async () => {
    const n8n = fakeN8n({ failures: [httpError(LIST_CALL, 403, 'Forbidden')] });

    const report = await run([fakeLocalWorkflow('a')], n8n, []);

    expect([report.exitCode, n8n.calls.includes(LIST_CALL)]).toEqual([0, false]);
  });

  test('Should update the workflow when its credential was recreated under the same name with a new id', async () => {
    const workflow = fakeLocalWorkflowUsing('a', ['slack']);
    const draft = fakeN8nWorkflow({ ...workflow, nodes: workflow.nodes.map((node) => ({ ...node, credentials: { httpHeaderAuth: { id: 'old-id', name: 'slack' } } })) }, { id: 'wa' });
    const n8n = fakeN8n({ workflows: [draft], credentials: [fakeCredential('slack', { id: 'new-id' })] });

    const report = await run([workflow], n8n, [fakeCredentialEntry('slack', { id: 'new-id' })], fakeManaged({ a: 'wa' }));

    expect(report.results).toEqual([expect.objectContaining({ stableName: 'a', action: 'updated' })]);
  });

  test('Should skip the workflow when its draft already holds the resolved credential', async () => {
    const workflow = fakeLocalWorkflowUsing('a', ['slack']);
    const draft = fakeN8nWorkflow({ ...workflow, nodes: workflow.nodes.map((node) => ({ ...node, credentials: { httpHeaderAuth: { id: 'slack-id', name: 'slack' } } })) }, { id: 'wa' });
    const n8n = fakeN8n({ workflows: [draft], credentials: [fakeCredential('slack')] });

    const report = await run([workflow], n8n, [fakeCredentialEntry('slack')], fakeManaged({ a: 'wa' }));

    expect(report.results).toEqual([expect.objectContaining({ stableName: 'a', action: 'skipped' })]);
  });
});
