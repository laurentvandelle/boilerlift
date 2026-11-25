import { describe, expect, test } from 'vitest';
import { fakeCredentialEntry, fakeWorkflowFileUsing } from '#src/core/compile/credential.fake';
import { fakeLocalWorkflow, fakeWorkflowFile, fakeWorkflowLoader } from '#src/core/compile/workflow.fake';
import { WorkflowFile } from '#src/core/compile/workflow.model';
import { isRecord } from '#src/core/common/is-record';
import { ProjectConfig } from '#src/core/config/config.model';
import { deliverTargets, loadDeliverySources } from '#src/core/deliver/deliver';
import { DeliverySources } from '#src/core/deliver/deliver.model';
import { FAKE_INSTANCE, fakeLockStore, fakeLockText } from '#src/core/lock/lock-file.fake';
import { fakeConnectedTarget, fakeCredential, fakeN8n } from '#src/core/n8n/n8n.fake';

const DEV_URL = 'https://dev.example.com';
const PROD_URL = 'https://prod.example.com';
const INVOICE = fakeWorkflowFile(fakeLocalWorkflow('invoice-sync', { path: 'workflows/invoice-sync.workflow.ts' }));

function sources(files: Record<string, WorkflowFile[]>, credentials: DeliverySources['credentials'] = []): DeliverySources {
  return { files: new Map(Object.entries(files)), credentials };
}

function config(targets: Record<string, { url: string; workflows: string }>): ProjectConfig {
  return { targets: Object.entries(targets).map(([name, { url, workflows }]) => ({ name, url, workflows, apiKey: 'secret', tag: true })) };
}

describe('loadDeliverySources', () => {
  test('Should read each declared folder once when two targets share a folder', async () => {
    const reads: string[] = [];
    const loadWorkflowFiles = (folder: string): Promise<WorkflowFile[]> => {
      reads.push(folder);
      return Promise.resolve([]);
    };

    await loadDeliverySources(config({ dev: { url: DEV_URL, workflows: './shared' }, prod: { url: PROD_URL, workflows: './shared' } }), [{ name: 'dev' }], {
      loadCredentialsFiles: () => Promise.resolve([]),
      loadWorkflowFiles,
    });

    expect(reads).toEqual(['./shared']);
  });

  test('Should read the credential lists before any workflow file when it loads the project', async () => {
    const reads: string[] = [];

    await loadDeliverySources(config({ dev: { url: DEV_URL, workflows: './dev' } }), [{ name: 'dev' }], {
      loadCredentialsFiles: (dir) => {
        reads.push(dir);
        return Promise.resolve([]);
      },
      loadWorkflowFiles: (folder) => {
        reads.push(folder);
        return Promise.resolve([]);
      },
    });

    expect(reads).toEqual(['credentials', './dev']);
  });

  test('Should refuse the two targets and the stable name when two targets on one instance hold the same stable name', async () => {
    const loadWorkflowFiles = fakeWorkflowLoader({
      './dev': [fakeWorkflowFile(fakeLocalWorkflow('invoice-sync', { path: 'dev/invoice-sync.json' }))],
      './demo': [fakeWorkflowFile(fakeLocalWorkflow('invoice-sync', { path: 'demo/invoice-sync.json' }))],
    });

    const loaded = await loadDeliverySources(config({ dev: { url: DEV_URL, workflows: './dev' }, demo: { url: DEV_URL, workflows: './demo' } }), [{ name: 'dev' }], {
      loadCredentialsFiles: () => Promise.resolve([]),
      loadWorkflowFiles,
    });

    expect(loaded).toEqual({
      ok: false,
      error: [{ stableName: 'invoice-sync', instance: DEV_URL, first: { target: 'dev', path: 'dev/invoice-sync.json' }, second: { target: 'demo', path: 'demo/invoice-sync.json' } }],
    });
  });
});

describe('deliverTargets', () => {
  test('Should report the invalid files and send nothing when a workflow file of the target does not load', async () => {
    const n8n = fakeN8n();
    const target = fakeConnectedTarget('dev', n8n.client);

    const [delivery] = await deliverTargets(
      { sources: sources({ './workflows': [{ path: 'workflows/Bad Name.json', content: {} }] }), targets: [target], mode: 'deploy' },
      { lock: fakeLockStore().store },
    );

    expect([delivery?.kind, n8n.calls]).toEqual(['invalid-files', []]);
  });

  test('Should say there is nothing to deploy and send nothing when the folder of the target is empty', async () => {
    const n8n = fakeN8n();

    const deliveries = await deliverTargets({ sources: sources({}), targets: [fakeConnectedTarget('dev', n8n.client)], mode: 'deploy' }, { lock: fakeLockStore().store });

    expect([deliveries.map(({ kind }) => kind), n8n.calls]).toEqual([['nothing-to-deploy'], []]);
  });

  test('Should report the lock file error and send nothing when the lock file is invalid', async () => {
    const n8n = fakeN8n();

    const [delivery] = await deliverTargets(
      { sources: sources({ './workflows': [INVOICE] }), targets: [fakeConnectedTarget('dev', n8n.client)], mode: 'deploy' },
      { lock: fakeLockStore({ text: '{ not json' }).store },
    );

    expect([delivery?.kind, delivery?.kind === 'invalid-lock-file' ? delivery.error.kind : undefined, n8n.calls]).toEqual(['invalid-lock-file', 'invalid-json', []]);
  });

  test('Should record the created workflow under the instance of the target when it deploys', async () => {
    const lock = fakeLockStore();

    await deliverTargets({ sources: sources({ './workflows': [INVOICE] }), targets: [fakeConnectedTarget('dev', fakeN8n().client)], mode: 'deploy' }, { lock: lock.store });

    expect(lock.recorded(FAKE_INSTANCE)).toEqual({ 'invoice-sync': 'w1' });
  });

  test('Should write nothing to the instance or the lock file when the mode is dry-run', async () => {
    const n8n = fakeN8n();
    const lock = fakeLockStore({ text: fakeLockText({}) });

    const [delivery] = await deliverTargets({ sources: sources({ './workflows': [INVOICE] }), targets: [fakeConnectedTarget('dev', n8n.client)], mode: 'dry-run' }, { lock: lock.store });

    expect([delivery?.kind, n8n.workflows, lock.saves()]).toEqual(['report', [], 0]);
  });

  test('Should record each target under its own instance in the lock file when it deploys two targets', async () => {
    const lock = fakeLockStore();
    const targets = [
      fakeConnectedTarget('dev', fakeN8n().client, { url: DEV_URL, workflows: './dev' }),
      fakeConnectedTarget('prod', fakeN8n().client, { url: PROD_URL, workflows: './prod' }),
    ];
    const files = {
      './dev': [fakeWorkflowFile(fakeLocalWorkflow('invoice-sync'))],
      './prod': [fakeWorkflowFile(fakeLocalWorkflow('crm-import'))],
    };

    await deliverTargets({ sources: sources(files), targets, mode: 'deploy' }, { lock: lock.store });

    expect([lock.recorded(DEV_URL), lock.recorded(PROD_URL)]).toEqual([{ 'invoice-sync': 'w1' }, { 'crm-import': 'w1' }]);
  });

  test('Should deploy the same folder to both instances when two targets share a workflows folder', async () => {
    const dev = fakeN8n();
    const prod = fakeN8n();
    const targets = [
      fakeConnectedTarget('dev', dev.client, { url: DEV_URL, workflows: './dev' }),
      fakeConnectedTarget('prod', prod.client, { url: PROD_URL, workflows: './dev' }),
    ];

    await deliverTargets({ sources: sources({ './dev': [INVOICE] }), targets, mode: 'deploy' }, { lock: fakeLockStore().store });

    expect([dev, prod].map((n8n) => n8n.workflows.map(({ name }) => name))).toEqual([['Workflow invoice-sync'], ['Workflow invoice-sync']]);
  });

  test('Should resolve each target through its own list when two targets pick the same key', async () => {
    const dev = fakeN8n({ credentials: [fakeCredential('slack', { id: 'dev-slack' })] });
    const prod = fakeN8n({ credentials: [fakeCredential('slack', { id: 'prod-slack', type: 'slackApi' })] });
    const credentials = [
      { path: 'credentials/dev.ts', content: [fakeCredentialEntry('slack', { id: 'dev-slack' })] },
      { path: 'credentials/prod.ts', content: [fakeCredentialEntry('slack', { id: 'prod-slack', type: 'slackApi' })] },
    ];
    const targets = [
      fakeConnectedTarget('dev', dev.client, { url: DEV_URL, workflows: './dev' }),
      fakeConnectedTarget('prod', prod.client, { url: PROD_URL, workflows: './prod' }),
    ];
    const files = { './dev': [fakeWorkflowFileUsing('dev/a.json', ['slack'])], './prod': [fakeWorkflowFileUsing('prod/a.json', ['slack'])] };

    await deliverTargets({ sources: sources(files, credentials), targets, mode: 'deploy' }, { lock: fakeLockStore().store });

    expect([dev, prod].map((n8n) => n8n.workflows.flatMap(({ nodes }) => nodes.map((node) => (isRecord(node) ? node.credentials : undefined))))).toEqual([
      [{ httpHeaderAuth: { id: 'dev-slack', name: 'slack' } }],
      [{ slackApi: { id: 'prod-slack', name: 'slack' } }],
    ]);
  });

  test('Should still deploy the next target when one target lacks a credential', async () => {
    const dev = fakeN8n();
    const prod = fakeN8n({ credentials: [fakeCredential('slack')] });
    const credentials = [{ path: 'credentials/prod.ts', content: [fakeCredentialEntry('slack')] }];
    const targets = [
      fakeConnectedTarget('dev', dev.client, { url: DEV_URL, workflows: './dev' }),
      fakeConnectedTarget('prod', prod.client, { url: PROD_URL, workflows: './prod' }),
    ];
    const files = { './dev': [fakeWorkflowFileUsing('dev/a.json', ['slack'])], './prod': [fakeWorkflowFileUsing('prod/a.json', ['slack'])] };

    await deliverTargets({ sources: sources(files, credentials), targets, mode: 'deploy' }, { lock: fakeLockStore().store });

    expect([dev.workflows.length, prod.workflows.length]).toEqual([0, 1]);
  });
});
